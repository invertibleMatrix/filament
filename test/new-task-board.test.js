// @ts-check
// HarnessV3-NewTask and the Start of proposal_ux §4.13, the page half: the board's rules as pure answers (what the bar
// draws, where the first request stands, where a value comes from, what Starts from says, what each card's head says,
// what a tool's chip holds, when two values are the same), the board drawn on the fake DOM (three questions, the first
// request, every card open in two stacks — one screen since the design pass of 10-24, UX5 — each change marked with ↺
// and one Undo all; every engine with every card, what it does not read greyed with why — D8; every control holds its
// change through the host, never a fetch), and the host's wiring pinned in
// the page's source — the board asks with the body the first send carries. Its first question asks who runs the
// session (HarnessV4_Tasks E15 step 6, AG-173): the agent itself, or a lead with its team. The server half is in
// new-task.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { anatomy, standing, engineWords, environmentWords, markOf, fromWords, knowsWords, headWords, sameValue, toolsAfter, whoRuns, createStartBoard, PARTS } from "../src/ui/harness/conversation/start-board.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { poolChips } from "./helpers/team-view.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ f) => readFileSync(join(ROOT, f), "utf8");

/** A draft-start answer as the server gives it (new-task.test.js pins the server's side of this shape). @param {any} [o] */
const answer = (o = {}) => ({
  cwd: "H:/proj",
  projectId: null,
  flat: { "context.strategy": "plain", "context.compaction.method": "summary", "context.compaction.thresholdPercent": 85, "loop.tools": null },
  sources: { "context.strategy": "global" },
  engine: { kind: "loop", model: "brain-model" },
  window: { tokens: 200000, source: "price card" },
  line: { percent: 85, tokens: 170000 },
  parts: [
    { id: "prompt", tokens: 3000 },
    { id: "instructions", tokens: 400 },
    { id: "skills", tokens: 120 },
    { id: "tools", tokens: 5000 },
    { id: "memory", tokens: 1650, upTo: true },
    { id: "message", tokens: 12 },
  ],
  loopFixed: 8520,
  instructions: { files: [{ file: "AGENTS.md", chars: 600, truncated: false }], missing: ["CLAUDE.md"], sessionChars: 0 },
  skills: { on: ["deploy", "lint"], list: [{ name: "deploy", description: "Ship a build" }, { name: "lint", description: "" }], triggered: ["deploy"], problems: [] },
  tools: { offered: ["read", "glob", "grep", "write", "edit", "bash", "agent", "ask", "plan"], off: ["bash_background"], memory: 0, recall: false, mcp: [] },
  memory: { global: true, autopilot: true, on: true, ready: true, briefing: 1200, recall: 450, tools: 0, knows: { memories: 3, dossier: 2 } },
  ...o,
});

/** Every node under `el` whose class list holds `cls`. @param {any} el @param {string} cls @returns {any[]} */
const allWith = (el, cls) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
const hidden = (/** @type {any} */ n) => n.classList.contains("hidden");

/**
 * The board on the fake DOM with a recording host; `menu` hears the menus it opens. Every card shows (UX5); `card("context")`
 * is the first request, which says what the Context card said.
 * @param {{ held?: Record<string, any>, chat?: any, models?: any[], menu?: (items: any[], o: any) => void,
 *   agents?: { cards: any[], asks: string[] }, agentName?: string, worksIn?: { control: any, line: any }, live?: boolean,
 *   teamsOn?: () => boolean }} [o]
 */
const boardWith = (o = {}) => {
  /** @type {any[]} */
  const calls = [];
  const held = o.held || {};
  // `live`: what is set is held at once, as the page's host holds it (empty.js), before the board paints again.
  const io = {
    held: () => held,
    set: (/** @type {string} */ path, /** @type {any} */ value) => { calls.push(["set", path, value]); if (o.live) held[path] = value; },
    unset: (/** @type {string} */ path) => { calls.push(["unset", path]); if (o.live) delete held[path]; },
    permission: () => "edit",
    setPermission: (/** @type {string} */ id) => calls.push(["permission", id]),
    models: () => o.models ?? [{ id: "brain-model" }],
    mainModel: () => "brain-model",
    agentName: () => o.agentName || "",
    agents: () => o.agents || { cards: [], asks: [] },
    manageMcp: () => calls.push(["manageMcp"]),
    chat: () => o.chat || {},
    reset: () => calls.push(["reset"]),
    ...(o.worksIn ? { worksIn: o.worksIn } : {}),
    ...(o.teamsOn ? { teamsOn: o.teamsOn } : {}),
  };
  const modelSelect = () => ({ el: fakeH("span", { class: "fake-model-select" }), set() {}, setModels() {} });
  const pools = poolChips();
  const board = createStartBoard(/** @type {any} */ (io), { h: /** @type {any} */ (fakeH), modelSelect: /** @type {any} */ (modelSelect), poolChip: /** @type {any} */ (pools.make), menu: /** @type {any} */ (o.menu) });
  const el = /** @type {any} */ (board.el);
  // The two stacks' cards, left then right.
  const cards = () => el.querySelector(".nt-grid").kids.flatMap((/** @type {any} */ s) => s.kids);
  const card = (/** @type {string} */ id) => (id === "context" ? el.querySelector(".nt-first") : cards().find((/** @type {any} */ c) => c.attrs["aria-label"] === id));
  return { board, calls, cards, card, pools, el };
};
/** The six cards, by their ids, in the stacks' order. */
const CARDS = ["tools", "memory", "skills", "compaction", "subagents", "instructions"];

// ---- the pure answers ------------------------------------------------------------------------------------------------

test("with no model to choose, the first request says no model can answer yet and links to the console's catalogue, in its own window (HarnessV3-Launch LD-D4)", () => {
  const { board, card } = boardWith({ models: [] });
  board.paint(answer({ engine: { kind: "none", model: null, why: "no model chosen yet" } }));
  const ctx = card("context");
  // (fails before: yes — it said "Nothing would answer yet — no model chosen yet", with no way to get one)
  assert.match(textOf(ctx), /\|No model can answer yet: connect one in the console\. \|Connect a model/);
  /** @type {any[]} */
  const links = [];
  const walk = (/** @type {any} */ n) => { if (n && typeof n === "object") { if (n.tag === "a") links.push(n); for (const k of n.kids || []) walk(k); } };
  walk(ctx);
  assert.deepEqual(links.map((a) => [a.attrs.href, a.attrs.target, textOf(a)]), [["/ui/?add=1#destinations", "filament-console", "Connect a model"]]);
  const withModel = boardWith();
  withModel.board.paint(answer({ engine: { kind: "none", model: null, why: "no model chosen yet" } }));
  assert.match(textOf(withModel.card("context")), /Nothing would answer yet — no model chosen yet/, "a model to choose: the server's why");
});

test("anatomy: the parts that weigh something, in the bar's order, memory's as a ceiling; an unknown part is never drawn", () => {
  const rows = anatomy(answer({ parts: [...answer().parts, { id: "mystery", tokens: 99 }] }));
  assert.deepEqual(rows.map((r) => r.id), ["prompt", "instructions", "skills", "tools", "memory", "message"]);
  assert.equal(rows.find((r) => r.id === "memory")?.upTo, true);
  assert.equal(rows.find((r) => r.id === "tools")?.upTo, false);
  assert.equal(rows.find((r) => r.id === "message")?.color, PARTS.message.color);
  assert.deepEqual(anatomy(null), []);
});

test("standing: the total over the window and the line — orange past the line (no history to compact yet), red past the window, quiet without a window", () => {
  const base = standing(answer());
  assert.equal(base.total, 3000 + 400 + 120 + 5000 + 1650 + 12);
  assert.deepEqual([base.window, base.line, base.percent, base.tone], [200000, 170000, 85, ""]);
  const at = (/** @type {number} */ msg) => standing(answer({ parts: [{ id: "message", tokens: msg }] })).tone;
  assert.equal(at(169999), "");
  assert.equal(at(170000), "warn", "at the line is past it: the first reply would compact nothing");
  assert.equal(at(200000), "error", "a first request as big as the window is refused");
  assert.equal(standing(answer({ window: { tokens: 0 }, parts: [{ id: "message", tokens: 9e9 }] })).tone, "", "an unknown window makes no claim");
});

test("engineWords: one sentence per engine — the loop's first request, a coding agent's own context, plain chat, nothing yet", () => {
  assert.match(engineWords({ kind: "loop", model: "m" }), /agent loop runs this chat/);
  assert.match(engineWords({ kind: "agent", model: "agent/claude" }), /agent\/claude is a coding agent: it builds its own context/);
  // (fails before: yes — HarnessV4_Tasks B12: a coding agent that leads a team read as an agent alone)
  assert.equal(engineWords({ kind: "agent", model: "coder-one", team: { key: "architect", name: "Architect" } }), "Team Architect leads this chat, its lead the coding agent coder-one: it builds its own context, and Filament adds its lead's part and its team's tools");
  assert.match(engineWords({ kind: "model", model: "m" }), /plain chat/);
  assert.match(engineWords({ kind: "none", why: "no route matches x" }), /Nothing would answer yet — no route matches x/);
  assert.match(engineWords(null), /Choose a model/);
});

test("markOf (NT-D2): a held change, the project's — and nothing for the dashboard's own value or the default", () => {
  const d = answer({ sources: { a: "session", b: "project", c: "global", e: "default" } });
  assert.equal(markOf("a", d, {}), "changed here", "a session knob is this chat's own");
  assert.equal(markOf("b", d, { b: 1 }), "changed here", "a held change outranks the project's value");
  assert.equal(markOf("b", d, {}), "this project");
  assert.equal(markOf("c", d, {}), "");
  assert.equal(markOf("e", d, {}), "");
});

// (fails before: yes — U5 phase 6: the head said "Starts from your defaults" beside a Start from… button; the owner's of
// 11-07: there are no presets, so the start comes from your defaults alone)
test("fromWords: where the start comes from — your defaults for the folder's project", () => {
  assert.equal(fromWords(answer()), "Your defaults for proj.");
  assert.equal(fromWords(answer({ cwd: null })), "Your defaults.");
  // (fails before: yes — the owner's of 10-31: a worktree's Start said "Your defaults for app-space", where the defaults
  // are its project's)
  assert.equal(fromWords(answer({ cwd: "H:\\w\\proj-space", projectName: "proj" })), "Your defaults for proj.", "a worktree: its project's");
  assert.equal(fromWords(answer({ outside: true, projectName: "Everything" })), "Your defaults, outside any project.", "no folder chosen: the chat works in Everything");
});

// (fails before: yes — outside a project the card said "Knows 0 memories about this project", the count of
// Everything's own alone, while the chat draws on what holds everywhere, and recall reaches every project's)
test("knowsWords: a project's memories and its dossier; outside a project, what holds everywhere and what earlier chats there left", () => {
  const knows = (/** @type {any} */ k, o = {}) => knowsWords(answer({ memory: { ...answer().memory, knows: k }, ...o }));
  assert.equal(knows({ memories: 3, dossier: 2 }), "Knows 3 memories about this project, and opens with its dossier (v2)");
  assert.equal(knows({ memories: 1, dossier: null }), "Knows 1 memory about this project");
  const outside = { outside: true, projectName: "Everything" };
  assert.equal(knows({ memories: 0, dossier: null, everywhere: 4 }, outside), "Knows 4 memories that hold everywhere. Your projects' memories join where your messages touch them.");
  assert.equal(knows({ memories: 2, dossier: null, everywhere: 1 }, outside), "Knows 1 memory that holds everywhere, and 2 from earlier chats outside a project. Your projects' memories join where your messages touch them.");
  assert.equal(knows({ memories: 0, dossier: null, everywhere: 0 }, outside), "Knows 0 memories that hold everywhere. Your projects' memories join where your messages touch them.");
  assert.equal(knowsWords(answer({ memory: { ...answer().memory, out: "kept out in Memory settings" } })), null, "a chat Memory settings leave out says no such thing");
  assert.equal(knows(null), null);
  // The card's head counts the same memories.
  assert.equal(headWords(answer({ ...outside, memory: { ...answer().memory, knows: { memories: 2, dossier: null, everywhere: 1 } } }), { permission: "edit", main: "m", held: {} }).memory.value, "On · 3 memories");
  assert.equal(headWords(answer({ memory: { ...answer().memory, knows: { memories: 2, dossier: null, everywhere: 9 } } }), { permission: "edit", main: "m", held: {} }).memory.value, "On · 2 memories", "in a project, its own alone");
});

// (fails before: a tool switched back on was dropped from the held object, and a tool your defaults switched off stayed off)
test("toolsAfter: a chip flips its own name and keeps the rest — on is set true, not dropped, so the held object outranks your defaults' false", () => {
  assert.deepEqual(toolsAfter(null, "bash", false), { bash: false });
  assert.deepEqual(toolsAfter({ bash: false, write: false }, "bash", true), { bash: true, write: false });
  assert.deepEqual(toolsAfter({ bash: false }, "bash", true), { bash: true }, "the start's off is overridden, not inherited again");
  assert.deepEqual(toolsAfter("junk", "edit", false), { edit: false });
});

// ---- the board on the fake DOM ---------------------------------------------------------------------------------------

// (fails before: yes — the design pass of 10-24, UX5: seven tiles over the cards, the cards shown on Show all cards, the
// first request at the foot under all of them)
test("the loop's board: the questions, then the first request with the Context card's words, then six cards in two stacks, every one painted", () => {
  const { board, card, cards, el } = boardWith();
  board.paint(answer());
  assert.deepEqual(el.kids.map((/** @type {any} */ k) => k.attrs.class.split(" ")[0]), ["nt-ask", "nt-first", "nt-grid"], "no tiles, no Show all cards");
  assert.deepEqual(el.querySelector(".nt-grid").kids.map((/** @type {any} */ s) => s.kids.map((/** @type {any} */ c) => c.attrs["aria-label"])), [["tools", "memory", "skills"], ["compaction", "subagents", "instructions"]]);
  assert.equal(cards().filter(hidden).length, 0);
  assert.ok(cards().every((/** @type {any} */ c) => c.kids.length > 0), "every card painted");
  const first = el.querySelector(".nt-first");
  assert.match(textOf(first), /^The first request\|what Brain Model will get with your message — it grows as you type\|10\.2K\| of 200K\|compacts at 170K · 85%\|/);
  assert.match(textOf(first), /Filament's agent loop runs this chat — this is its first request\./, "who builds it, as the Context card said");
  assert.equal(allWith(first, "is-hatch").length, 1, "memory's share is a ceiling, drawn striped");
  assert.match(String(allWith(first, "inst-stack-notch")[0]?.attrs.style), /left:85%/);
  assert.match(textOf(first), /Memory up to 1\.6K/);
  assert.match(textOf(card("memory")), /Knows 3 memories about this project, and opens with its dossier \(v2\)/);
  assert.match(textOf(card("skills")), /deploy\|Your message names it: the agent loads it as it needs it\|lint/);
  assert.match(textOf(card("instructions")), /AGENTS\.md\|600 characters/);
  assert.match(textOf(card("instructions")), /Looked for, not found: CLAUDE\.md/);
  assert.match(textOf(card("compaction")), /^Compaction\|How room is made when the chat is full\|/, "the card says how room is made, not how earlier turns are sent: every turn goes whole");
  assert.doesNotMatch(textOf(card("compaction")), /Sent as/);
});

// (fails before: no — a guard the mutation pass asked for: no board drew a team's engine)
test("a team's lead builds the first request as the loop does (HarnessV3-AtHome P2): its sentence, and all six cards", () => {
  assert.equal(engineWords({ kind: "team", model: "m", team: { key: "architect", name: "Architect" } }), "Team Architect leads this chat on Filament's agent loop — this is its lead's first request");
  const { board, cards, card } = boardWith();
  board.paint(answer({ engine: { kind: "team", model: "brain-model", team: { key: "architect", name: "Architect" } } }));
  assert.equal(cards().filter(hidden).length, 0);
  assert.equal(allWith(card("tools"), "nt-dim").length, 0, "nothing greyed: the lead is the loop");
});

// (fails before: yes — U5 phase 6, D8: another engine's board hid the cards it does not read, three for plain chat and
// two for a coding agent, and nothing said what Filament adds to it)
test("every engine has every card (D8): what it does not read is greyed under the line that says why, out of reach; the rest works", () => {
  const { board, cards, card, el, calls } = boardWith({ agentName: "Claude Code" });
  const dimOf = (/** @type {string} */ id) => allWith(card(id), "nt-dim");
  board.paint(answer({ engine: { kind: "agent", model: "agent/claude" }, tools: { offered: [], off: ["artifact"], adds: ["browser", "show_visual", "team", "flow"], hands: "own", memory: 6, recall: false, mcp: ["github"] }, instructions: { files: [], missing: [], sessionChars: 0 }, skills: { on: [], list: [], triggered: [], problems: [] } }));
  assert.equal(cards().filter(hidden).length, 0, "all six");
  // Tools: its permission and what Filament adds work; the loop's switches that do not reach it are greyed with why.
  const tools = card("tools");
  assert.match(textOf(tools), /^Tools\|Claude Code's own, and what Filament adds\|Claude Code's own\|Permission mode/);
  // (fails before: yes — the owner's look of 10-24: every one of the loop's switches was greyed, the browser,
  // pictures, artifacts, teams and flows among them, though each reaches Claude Code over Filament's MCP server)
  assert.equal(allWith(tools, "nt-card-tag")[0].classList.contains("is-dim"), false, "what Filament adds works: the head is not greyed");
  assert.match(textOf(tools), /From Filament\|Browser\|Pictures\|Artifacts\|Teams\|Flows\|Filament's agent tool comes with every chat\.\|Plus memory's 6 tools\.\|Connectors\|github/);
  const live = allWith(tools, "nt-chip").filter((/** @type {any} */ c) => c.attrs.role === "switch");
  assert.deepEqual(live.map((/** @type {any} */ c) => [c.attrs["data-tool"], c.attrs["aria-checked"]]), [["browser", "true"], ["show_visual", "true"], ["artifact", "false"], ["team", "true"], ["flow", "true"]], "no Space chip: the chat has no project's");
  live[1].dispatch("click");
  assert.deepEqual(calls.pop(), ["set", "loop.tools", { show_visual: false }]);
  live[2].dispatch("click");
  assert.deepEqual(calls.pop(), ["set", "loop.tools", { artifact: true }]);
  live[0].dispatch("click");
  assert.deepEqual(calls.pop(), ["set", "plugins.browser", false], "the browser rides its plugin switch, as the loop's does");
  assert.match(textOf(tools), /Files, commands, the web's fetch and search, questions and plans: Claude Code's own tools, so the loop's switches for these don't reach it\./);
  assert.deepEqual([dimOf("tools").length, dimOf("tools")[0].attrs.inert, dimOf("tools")[0].attrs["aria-disabled"]], [1, "", "true"]);
  assert.match(textOf(dimOf("tools")[0]), /^Files\|Read\|Find files\|Search text\|Language servers\|Write\|Edit\|Shell\|.*\|Team\|Ask you\|Plan\|Reader\|Web\|Fetch a page\|Web search$/, "its own to do, by family; nothing it is handed");
  assert.equal(allWith(dimOf("tools")[0], "inst-seg").length, 0, "the permission mode is not greyed: it reaches the agent");
  // Its client bridge native: Filament's six hands do its files and commands, and the card says so.
  board.paint(answer({ engine: { kind: "agent", model: "agent/claude" }, tools: { offered: [], off: [], adds: [], hands: "native", memory: 0, recall: false, mcp: [] } }));
  assert.match(textOf(card("tools")), /Files and commands: Filament's Read, Write, Edit, Bash, Glob and Grep, in place of Claude Code's own \(its client bridge is native\)/);
  // Skills reach it through Filament's skill tool (HarnessV4_Skills_Plan S1-1): nothing greyed; the instruction files
  // greyed, and the box off with why.
  assert.match(textOf(card("skills")), /Claude Code loads these with Filament's skill tool, and the skills of its own folders with its own\./);
  assert.equal(dimOf("skills").length, 0, "nothing of the card is greyed for a coding agent");
  assert.match(textOf(card("instructions")), /Claude Code reads its own instruction files, as it does outside Filament\./);
  const box = allWith(card("instructions"), "nt-extra")[0];
  assert.equal(box.disabled, true);
  assert.match(textOf(card("instructions")), /It rides Filament's loop's prompt, which Claude Code doesn't read\./);
  // Compaction: its own way.
  assert.match(textOf(card("compaction")), /Makes room by\|.*\|Suggested/);
  assert.match(textOf(card("context")), /agent\/claude is a coding agent/);
  // Plain chat: tools, the agents on the side, skills and instructions greyed; memory and compaction work.
  board.paint(answer({ engine: { kind: "model", model: "plain-model" } }));
  assert.equal(cards().filter(hidden).length, 0);
  for (const id of ["tools", "subagents", "skills", "instructions"]) assert.equal(dimOf(id).length, 1, id);
  for (const id of ["memory", "compaction", "context"]) assert.equal(dimOf(id).length, 0, id);
  assert.match(textOf(card("tools")), /Filament's agent loop does not run plain-model: the turns go to it as plain chat\./);
  // Back on the loop, nothing is greyed and the box takes words again.
  board.paint(answer());
  assert.equal(CARDS.map((id) => dimOf(id).length).join(""), "000000");
  assert.equal(allWith(card("instructions"), "nt-extra")[0].disabled, false);
  assert.equal(el.querySelector(".nt-extra-why").classList.contains("hidden"), true);
});

test("the cards hold, never write: a tool's chip, memory's switch and the permission each go to the host as one held change", () => {
  const { board, calls, card } = boardWith();
  board.paint(answer());
  // A chip by its tool's own name; its face in plain words, the name in its title (the design pass of 10-24).
  const chip = (/** @type {string} */ name) => allWith(card("tools"), "nt-chip").find((/** @type {any} */ c) => c.attrs["data-tool"] === name);
  assert.deepEqual([chip("bash").kids[0], chip("bash").attrs.title], ["Commands", "Commands (bash): offered — click to switch it off for this chat"]);
  assert.deepEqual([chip("bash_background").kids[0], chip("bash_background").attrs.title], ["Background commands", "Background commands (bash_background): off — click to offer it"]);
  assert.equal(chip("bash").classList.contains("is-on"), true);
  chip("bash").dispatch("click");
  assert.deepEqual(calls.pop(), ["set", "loop.tools", { bash: false }]);
  assert.equal(chip("bash_background").classList.contains("is-on"), false, "a tool the start switched off shows off");
  chip("bash_background").dispatch("click");
  assert.deepEqual(calls.pop(), ["set", "loop.tools", { bash_background: true }]);
  assert.equal(chip("delegate_read"), undefined, "a tool this task cannot offer (no reader model) has no chip");
  // A web hand rides its plugin switch.
  chip("web_search").dispatch("click");
  assert.deepEqual(calls.pop(), ["set", "plugins.web.search", true]);
  // The space tool's chip stands where the turn offers it, once the project's Space is in use (proposal_ux §4.14).
  assert.equal(chip("space"), undefined, "a project whose Space is not in use: no chip");
  board.paint(answer({ tools: { ...answer().tools, offered: [...answer().tools.offered, "space"] } }));
  assert.equal(chip("space").classList.contains("is-on"), true);
  chip("space").dispatch("click");
  assert.deepEqual(calls.pop(), ["set", "loop.tools", { space: false }]);

  const memSwitch = allWith(card("memory"), "ios-switch")[0];
  memSwitch.dispatch("change", { target: { checked: false } });
  assert.deepEqual(calls.pop(), ["set", "memory.enabled", false]);

  const seg = allWith(card("tools"), "inst-seg")[0];
  assert.deepEqual(seg.kids.map((/** @type {any} */ b) => b.kids[0]), ["Read-only", "Ask", "Edit", "Full"], "least free to most");
  assert.equal(seg.kids[2].classList.contains("is-on"), true, "the composer's mode is the chosen one");
  seg.kids[3].dispatch("click");
  assert.deepEqual(calls.pop(), ["permission", "auto"]);
});

// (fails before: yes — come_back had no chip: the chat's switch for coming back later was out of the person's reach)
test("Come back later (the Designer's of 10-27): its chip where the turn offers it, on by default; a press switches it off for this chat; never a coding agent's own", () => {
  const { board, calls, card } = boardWith();
  const chip = () => allWith(card("tools"), "nt-chip").find((/** @type {any} */ c) => c.attrs["data-tool"] === "come_back");
  board.paint(answer());
  assert.equal(chip(), undefined, "a start that does not offer it (a lead's chat) has no chip");
  board.paint(answer({ tools: { ...answer().tools, offered: [...answer().tools.offered, "come_back"] } }));
  assert.deepEqual([chip().kids[0], chip().attrs.title, chip().attrs["aria-checked"]], ["Come back later", "Come back later (come_back): offered — click to switch it off for this chat", "true"]);
  assert.match(textOf(card("tools")), /\|Come back later\|Come back later$/, "a family of its own, last");
  chip().dispatch("click");
  assert.deepEqual(calls.pop(), ["set", "loop.tools", { come_back: false }]);
  board.paint(answer({ tools: { ...answer().tools, off: ["come_back"] } }));
  assert.equal(chip().attrs["aria-checked"], "false", "switched off, it shows off");
  board.paint(answer({ engine: { kind: "agent", model: "agent/claude" }, tools: { offered: [], off: [], adds: [], hands: "own", memory: 0, recall: false, mcp: [] } }));
  assert.doesNotMatch(textOf(card("tools")), /Come back later/, "only Filament's own agent comes back later: no coding agent's own tool");
});

// (fails before: yes — the card had "A memory brief", a switch that sent sub-agents out without memory's brief; the
// owner's of 11-09: "memory system is core", so every sub-agent gets it where the chat's memory is on)
test("the sub-agents card has no switch for memory's brief: whatever an old chat holds, no row says it", () => {
  const { board, card } = boardWith();
  board.paint(answer({ flat: { ...answer().flat, "subagents.memory": false } }));
  assert.equal(allWith(card("subagents"), "ios-switch").find((/** @type {any} */ s) => s.attrs["aria-label"] === "A memory brief"), undefined);
  assert.doesNotMatch(textOf(card("subagents")), /memory brief|Rules, dossier and pitfalls/i);
});

// (fails before: yes — the owner's word of 10-31: a sub-agent handed the chat takes on its view, and one handed its task
// alone answers apart; the card had a "Carry earlier turns as" row that set what every sub-agent of the chat saw)
test("the sub-agents card sets no view of the chat for them: each sees its task alone, unless its launch hands it more", () => {
  const { board, card } = boardWith();
  board.paint(answer());
  const text = textOf(card("subagents"));
  assert.ok(!text.includes("Carry earlier turns as"), text);
  assert.ok(!text.includes("What they see"));
  assert.equal(wordsOf(answer()).subagents.sub, "each sees its task alone", "the tile says so");
});

// (fails before: yes — U5 phase 6: the head was one sentence over the cards, with Start from… and Reset beside it;
// the design pass of 10-24, UX5: "2 changes held for this chat." and a Reset link)
test("Starts from: the chip, where the start comes from, how many changes are held and one Undo all, and a failed answer said in words — before any answer too", () => {
  const quiet = boardWith();
  quiet.board.paint(answer());
  const row = (/** @type {any} */ b) => b.el.querySelector(".nt-from");
  assert.equal(textOf(row(quiet)), "Starts from|your settings, then what you change below|Your defaults for proj.|Nothing starts until you send · a row you change shows a dot and ↺");
  assert.equal(buttonsOf(quiet.el.querySelector(".nt-undo-all")).length, 0, "nothing held: nothing to undo");

  const busy = boardWith({ held: { "memory.enabled": false, "context.strategy": "rolling" } });
  busy.board.paint(answer());
  const all = busy.el.querySelector(".nt-undo-all");
  assert.equal(textOf(row(busy)), "Starts from|your settings, then what you change below|Your defaults for proj.|2 changed for this chat");
  assert.deepEqual(buttonsOf(all).map((x) => [x.attrs["aria-label"], x.attrs.title]), [["Undo all", "Undo all: drop every change you made for this chat"]]);
  buttonsOf(all)[0].dispatch("click");
  assert.deepEqual(busy.calls.pop(), ["reset"]);

  busy.board.pending(true);
  assert.equal(busy.el.classList.contains("is-pending"), true);
  busy.board.failed("the folder is gone");
  assert.equal(busy.el.classList.contains("is-pending"), false);
  assert.equal(textOf(busy.el.querySelector(".nt-status")), "the folder is gone");
  busy.board.paint(answer());
  assert.equal(textOf(busy.el.querySelector(".nt-status")), "", "the next answer clears it");

  // Before its first answer the board stands with its questions alone, and says why it has no figures.
  const early = boardWith();
  assert.equal(early.el.classList.contains("is-blank"), true);
  early.board.failed("the server is gone");
  assert.equal(textOf(early.el.querySelector(".nt-status")), "the server is gone");
  early.board.paint(answer());
  assert.equal(early.el.classList.contains("is-blank"), false);
});

test("the Instructions card's box: held after a pause, dropped when emptied, and shown from the held text across paints", async () => {
  const { board, calls, card } = boardWith({ held: { "instructions.session": "Be brief." } });
  board.paint(answer());
  const box = allWith(card("instructions"), "nt-extra")[0];
  assert.equal(box.value, "Be brief.", "the held text, not the start's");
  box.value = "  Always cite the file.  ";
  box.dispatch("input");
  assert.equal(calls.length, 0, "held after a pause, not on every key");
  await new Promise((r) => setTimeout(r, 350));
  assert.deepEqual(calls.pop(), ["set", "instructions.session", "Always cite the file."]);
  box.value = "   ";
  box.dispatch("input");
  await new Promise((r) => setTimeout(r, 350));
  assert.deepEqual(calls.pop(), ["unset", "instructions.session"]);
  board.paint(answer());
  assert.equal(allWith(card("instructions"), "nt-extra")[0], box, "the same box survives a paint (the caret is never lost)");
});

// (fails before: the drive's coding-agent board filled a window-less bar)
test("another engine's context is Filament's side only, said so; no window notches no line; a coding agent's memory is any engine's", () => {
  const { board, card, el } = boardWith({ agentName: "Coder" });
  board.paint(answer({ engine: { kind: "agent", model: "coder-one" }, parts: [{ id: "message", tokens: 40 }] }));
  assert.match(textOf(el.querySelector(".nt-first-head")), /^The first request\|what Filament adds to Coder's own — it grows as you type\|40\| of 200K\|compacts at 170K · 85%$/);
  assert.match(textOf(card("context")), /coder-one is a coding agent: it builds its own context/);
  assert.match(textOf(card("memory")), /What it will remember and recall/, "memory hands a coding agent what it hands any engine (AC4-2)");
  board.paint(answer({ window: { tokens: null }, line: { percent: 85, tokens: null } }));
  assert.match(textOf(card("context")), /This model's window is not known/);
  assert.equal(textOf(el.querySelector(".nt-first-line")), "", "no window: no line said");
  const first = el.querySelector(".nt-first");
  assert.equal(allWith(first, "inst-stack-notch").length, 0, "no window: no line to notch, the parts share the bar");
  assert.match(textOf(first), /Filament's agent prompt 3K/, "the legend still says the parts");
  assert.match(textOf(first), /This model's window is not known — set it on the Upstreams page\./);
});

test("the first request's tone: past the line it is orange in words, past the window red, and MCP servers are named, not guessed", () => {
  const { board, card, el } = boardWith();
  board.paint(answer({ parts: [{ id: "prompt", tokens: 180000 }], tools: { ...answer().tools, mcp: ["github", "linear"] } }));
  assert.equal(el.querySelector(".nt-first-fig").classList.contains("is-warn"), true);
  assert.match(textOf(card("context")), /Past the compaction line before any history/);
  assert.match(textOf(card("context")), /Plus the tools of github, linear — counted once they connect on the first turn/);
  board.paint(answer({ parts: [{ id: "prompt", tokens: 250000 }] }));
  assert.equal(el.querySelector(".nt-first-fig").classList.contains("is-error"), true);
  assert.match(textOf(card("context")), /Bigger than the window: the model would refuse it/);
});

// (fails before: yes — the Tools card named the servers in one line, with no test and no way to the list)
test("HC-26: the Tools card lists the connectors the task starts with, each dotted by its last test, and goes to Library › Plugins & Connectors", () => {
  const { board, card, calls } = boardWith();
  board.paint(answer({ tools: { ...answer().tools, mcp: ["github", "linear", "fs"], mcpTests: { github: { ok: true, words: "2 tools: 1 only read" }, linear: { ok: false, words: "The server refused: 401. Check the Authorization header." }, fs: null } } }));
  const chips = allWith(card("tools"), "nt-mcp");
  assert.deepEqual(chips.map((c) => textOf(c)), ["github", "linear", "fs"]);
  assert.deepEqual(chips.map((c) => allWith(c, "nt-mcp-dot")[0].attrs.class), ["nt-mcp-dot is-ok", "nt-mcp-dot is-bad", "nt-mcp-dot"]);
  assert.deepEqual(chips.map((c) => c.attrs.title), ["github: 2 tools: 1 only read", "linear: failed — The server refused: 401. Check the Authorization header.", "fs: not tested — Library › Plugins & Connectors tests it"]);
  assert.match(textOf(card("tools")), /Connectors\|github\|linear\|fs\|Connected on the first turn\.\|Connectors in the Library/);
  buttonsOf(card("tools")).find((b) => textOf(b) === "Connectors in the Library").dispatch("click");
  assert.deepEqual(calls.at(-1), ["manageMcp"]);
  board.paint(answer());
  assert.equal(allWith(card("tools"), "nt-mcp").length, 0, "no server: no section");
});

test("environmentWords and the first request (HarnessV3-SystemPrompt): where the prompt says the agent runs, in one line; nothing when the loop sends no section", () => {
  const env = { system: "Windows 11 Pro", shell: "cmd.exe", zone: "Europe/London", git: "main" };
  assert.equal(environmentWords(env), "Its prompt says where it runs: Windows 11 Pro · cmd.exe for commands · Europe/London · git main.");
  assert.equal(environmentWords({ ...env, git: null }), "Its prompt says where it runs: Windows 11 Pro · cmd.exe for commands · Europe/London · not a git repository.");
  assert.equal(environmentWords(null), null);
  const { board, card } = boardWith();
  board.paint(answer({ environment: env }));
  assert.match(textOf(card("context")), /Its prompt says where it runs: Windows 11 Pro · cmd\.exe for commands · Europe\/London · git main\./);
  board.paint(answer());
  assert.doesNotMatch(textOf(card("context")), /Its prompt says where it runs/);
});

// (fails before: yes — HarnessV3-AtHome AH-D3: the foot linked "All settings" and Start from… offered "All settings…",
// both opening the Customize this start dialog over every knob)
// (and the owner's of 11-07: there are no presets, so Starts from is words and an Undo all, no menu)
test("no door to a settings dialog (AH-D3): nothing starts until you send, said once, and Starts from offers no presets", () => {
  /** @type {any[][]} */
  const menus = [];
  const { board, el } = boardWith({ menu: (items) => menus.push(items) });
  board.paint(answer());
  assert.doesNotMatch(textOf(el), /All settings|[Pp]reset/);
  assert.equal(textOf(el).match(/Nothing starts until you send/gi)?.length, 1, "said once, beside Starts from");
  assert.equal(el.querySelector(".nt-from-chip"), null, "no Start from… chip");
  assert.equal(menus.length, 0);
});

// (fails before: yes — HarnessV4_Skills_Plan S1-6: the card had one master switch over a list of folders, and the
// abilities under it; a skill could not be turned off for one chat)
test("the Skills card: a switch for each skill on here — off holds it off for this chat alone, on again drops that; none on says where to turn one on", () => {
  const { board, card, calls } = boardWith();
  board.paint(answer());
  const switches = () => allWith(card("skills"), "ios-switch");
  assert.deepEqual(switches().map((s) => [s.attrs["aria-label"], s.checked]), [["deploy", true], ["lint", true]]);
  switches()[1].dispatch("change", { target: { checked: false } });
  assert.deepEqual(calls.pop(), ["set", "skills.on", [{ name: "lint", enabled: false }]]);
  // Held off: the skill leaves the list the server answers, and stays here with its switch off.
  const held = { "skills.on": [{ name: "lint", enabled: false }] };
  const off = boardWith({ held });
  off.board.paint(answer({ skills: { on: ["deploy"], list: [{ name: "deploy", description: "Ship a build" }], triggered: [], problems: [] } }));
  const sw = allWith(off.card("skills"), "ios-switch");
  assert.deepEqual(sw.map((s) => [s.attrs["aria-label"], s.checked]), [["deploy", true], ["lint", false]]);
  assert.match(textOf(off.card("skills")), /lint\|Off in this chat/);
  sw[1].dispatch("change", { target: { checked: true } });
  assert.deepEqual(off.calls.pop(), ["unset", "skills.on"], "on again: back to what it starts with");
  // None on: where to turn one on, and no dialog (AH-D3).
  board.paint(answer({ skills: { on: [], list: [], triggered: [], problems: ["the skill pdf is on here but is not in Library › Skills, or its folder is gone"] } }));
  assert.match(textOf(card("skills")), /No skill is on here yet: Library › Skills turns one on for all chats or this project\.\|the skill pdf is on here but is not in Library › Skills/);
  assert.doesNotMatch(textOf(card("skills")), /All settings|Abilities/);
});

// (fails before: yes — Hunter's finds: two switches turned before the board painted again kept only the second's word;
// a plugin's skill had a switch whose off wrote a name skills.on refuses)
test("the Skills card: two turned off before it paints again are both held; a plugin's skill is on where its plugin is, its switch not pressed", () => {
  const { board, card, calls } = boardWith({ live: true });
  board.paint(answer());
  const switches = () => allWith(card("skills"), "ios-switch");
  switches()[1].dispatch("change", { target: { checked: false } });
  switches()[0].dispatch("change", { target: { checked: false } });
  assert.deepEqual(calls.pop(), ["set", "skills.on", [{ name: "lint", enabled: false }, { name: "deploy", enabled: false }]], "the first's word kept");
  const plug = boardWith();
  plug.board.paint(answer({ skills: { on: ["deploy"], list: [{ name: "deploy", description: "Ship a build" }, { name: "linear:triage", description: "Triage issues", plugin: "linear" }], triggered: [], problems: [] } }));
  const sw = allWith(plug.card("skills"), "ios-switch");
  assert.deepEqual(sw.map((s) => [s.attrs["aria-label"], s.checked, "disabled" in s.attrs]), [["deploy", true, false], ["linear:triage", true, true]]);
  assert.match(textOf(plug.card("skills")), /linear:triage\|From the linear plugin: on where the plugin is on/);
});

// ---- the cards' heads: the tiles' words until UX5 (proposal_ux §4.13, D5, D8) ----------------------------------------

/** The heads' words for an answer, with the page's side as a test sets it. @param {any} d @param {Record<string, any>} [o] */
const wordsOf = (d, o = {}) => headWords(d, { who: "", permission: "edit", main: "brain-model", held: {}, ...o });

// (fails before: yes — U5 phase 6: the board drew seven cards and no tiles)
// (fails before: yes — the bug round of 10-23: the board said "up to 4" in a team's chat, which ran as its team says)
// (fails before: yes — the owner's word of 11-05: a chat has no number of its own, so the board says none)
test("headWords says the model agents run on, and no count: each model's limit holds", () => {
  assert.equal(wordsOf({ ...answer(), most: 7 }).subagents.value, "Brain Model", "an older server's count says nothing");
  assert.equal(wordsOf(answer()).subagents.value, "Brain Model");
});

test("headWords on the loop: each card's value, and a line more for its tooltip", () => {
  const w = wordsOf(answer());
  assert.deepEqual(CARDS.map((id) => [id, w[/** @type {keyof typeof w} */ (id)].value, w[/** @type {keyof typeof w} */ (id)].sub, !!w[/** @type {keyof typeof w} */ (id)].dim]), [
    ["tools", "9 tools", "Edit automatically", false],
    ["memory", "On · 3 memories", "recalled from your message", false],
    ["skills", "2 on", "120 tokens", false],
    ["compaction", "At 85% · ask me", "One summary", false],
    ["subagents", "Brain Model", "each sees its task alone", false],
    ["instructions", "AGENTS.md", "+ nothing extra", false],
  ]);
  assert.equal(Object.hasOwn(w, "context"), false, "the first request says its own figure");
  // Memory muted or off, the agent tool off, a pool of its own, words held.
  assert.deepEqual(wordsOf(answer({ memory: { ...answer().memory, on: false } })).memory, { value: "Muted", sub: "recording continues" });
  assert.deepEqual(wordsOf(answer({ memory: { ...answer().memory, global: false } })).memory, { value: "Off", sub: "off in Memory settings" });
  assert.deepEqual(wordsOf(answer({ tools: { ...answer().tools, off: ["agent"] } })).subagents, { value: "Off", sub: "the agent tool is off", tone: "warn" });
  const flat = { ...answer().flat, "subagents.pool": [{ model: "glm-5.3-flash" }], "context.compaction.mode": "auto", "context.compaction.thresholdPercent": 70, "context.compaction.method": "fold" };
  const own = wordsOf(answer({ flat, skills: { ...answer().skills, triggered: [] }, parts: [{ id: "skills", tokens: 800 }] }), { held: { "instructions.session": "Be brief." } });
  // (the owner's word of 11-05: no count of the chat's own — each model's limit holds)
  assert.deepEqual([own.subagents.value, own.subagents.sub], ["GLM-5.3 Flash", "each sees its task alone"]);
  assert.deepEqual([own.compaction.value, own.compaction.sub], ["At 70% · by itself", "Instant fold"]);
  assert.deepEqual([own.skills.value, own.skills.sub], ["2 on", "800 tokens"]);
  assert.deepEqual(wordsOf(answer({ skills: { on: [], list: [], triggered: [], problems: [] }, parts: [] })).skills, { value: "None on", sub: "Library › Skills turns one on" });
  assert.equal(own.instructions.sub, "+ your words");
});

// (fails before: yes — U5 phase 6, D8)
test("headWords for a coding agent and for plain chat: what does not apply is greyed, with why; what Filament adds is counted", () => {
  const coder = wordsOf(answer({ engine: { kind: "agent", model: "claude-code" }, tools: { offered: [], off: [], adds: ["browser", "show_visual"], memory: 6, recall: false, mcp: ["github"] } }), { who: "Claude Code" });
  // (the owner's look of 10-24: what Filament adds is counted, and the card is no longer greyed)
  assert.deepEqual(coder.tools, { value: "Claude Code's own", sub: "+ 8 tools, 1 server from Filament" });
  // (fails before: yes — the owner's of 11-06: "Named at each launch", where a launch that names none runs on the chat's model)
  assert.deepEqual([coder.subagents.value, coder.compaction.sub], ["Brain Model", "The suggested way"]);
  assert.deepEqual(coder.instructions, { value: "Claude Code's own", sub: "it reads its own files", dim: true, why: "Claude Code reads its own instruction files; Filament's ride its loop's prompt" });
  assert.deepEqual(coder.skills, { value: "2 on", sub: "through Filament's skill tool" }, "its skill tool offers them");
  const way = (/** @type {string} */ id) => wordsOf(answer({ engine: { kind: "agent", model: "claude-code" }, flat: { ...answer().flat, "context.compaction.agent": id } }), { who: "Claude Code" }).compaction.sub;
  assert.deepEqual(["own", "self", "ours"].map(way), ["Claude Code's own way", "Claude Code writes the summary", "Filament's copy"]);
  const plain = wordsOf(answer({ engine: { kind: "model", model: "plain-model" } }));
  // (the abilities that reached plain chat are gone: its skills head is greyed with the card)
  assert.deepEqual(CARDS.filter((id) => plain[/** @type {keyof typeof plain} */ (id)].dim), ["tools", "skills", "subagents", "instructions"]);
  assert.equal(plain.tools.why, "Filament's agent loop does not run plain-model: the turns go to it as plain chat");
});

// (fails before: yes — the design pass of 10-24, UX5: a change said "changed" on its tile and "changed here" under its
// row, and only Reset took changes back, all of them)
test("a row you changed has its dot and ↺ beside it, which drops that change alone; a section's title the same; the rest unmarked", () => {
  const held = { "memory.learn": false, "context.compaction.thresholdPercent": 60, "subagents.ask": ["pm"], "skills.on": [{ name: "old", enabled: false }] };
  const { board, calls, card } = boardWith({ held });
  board.paint(answer({ flat: { ...answer().flat, ...held } }));
  const owns = (/** @type {string} */ id) => allWith(card(id), "nt-own");
  // Memory: Learn from this chat, marked; its sub its own words, not "changed here".
  assert.deepEqual(owns("memory").map((x) => textOf(x.kids[0]).split("|")[0]), ["Learn from this chat"]);
  assert.doesNotMatch(textOf(card("memory")), /changed here/);
  const back = buttonsOf(owns("memory")[0]).at(-1);
  assert.deepEqual([back.attrs["aria-label"], back.attrs.title], ["Put back Learn from this chat", "Put back Learn from this chat as the chat starts: drop your change"]);
  back.dispatch("click");
  assert.deepEqual(calls.pop(), ["unset", "memory.learn"]);
  // A section's title: the line. The skills this chat turned off, marked as one.
  const titled = (/** @type {string} */ id) => allWith(card(id), "nt-own-k").map((x) => textOf(x));
  assert.deepEqual(titled("compaction"), ["The line"]);
  assert.equal(owns("skills").length, 1);
  buttonsOf(owns("skills")[0]).at(-1).dispatch("click");
  assert.deepEqual(calls.pop(), ["unset", "skills.on"]);
  buttonsOf(allWith(card("compaction"), "nt-own-k")[0])[0].dispatch("click");
  assert.deepEqual(calls.pop(), ["unset", "context.compaction.thresholdPercent"]);
  // A row that is a button keeps ↺ outside it.
  const asks = owns("subagents")[0];
  assert.deepEqual([asks.kids[0].tag, asks.kids[1].attrs.class], ["button", "nt-undo"]);
  assert.equal(owns("tools").length + titled("tools").length + titled("instructions").length, 0, "nothing else marked");
});

test("a change back to what the start gives is none: the held one dropped; a choice of the value it has holds nothing", () => {
  assert.equal(sameValue("loop.tools", { bash: false, edit: false }, { edit: false, bash: false }), true, "the names in any order");
  assert.equal(sameValue("loop.tools", {}, null), true);
  assert.equal(sameValue("loop.tools", { bash: true }, null), false, "set true is not left out: a lower layer may switch it off");
  assert.equal(sameValue("context.strategy", "plain", "plain"), true);
  const held = { "memory.learn": false };
  const { board, calls, card } = boardWith({ held });
  board.paint(answer({ flat: { ...answer().flat, ...held, "subagents.workspace": "auto" }, base: { "memory.learn": true } }));
  const learn = allWith(card("memory"), "ios-switch").find((/** @type {any} */ s) => s.attrs["aria-label"] === "Learn from this chat");
  learn.dispatch("change", { target: { checked: true } });
  assert.deepEqual(calls, [["unset", "memory.learn"]], "flipped back: dropped, not held as true");
  calls.length = 0;
  const auto = allWith(card("subagents"), "inst-seg-btn").find((/** @type {any} */ b) => textOf(b) === "Auto");
  auto.dispatch("click");
  assert.deepEqual(calls, [], "the value it has: nothing held");
});

test("a tool family's ↺ puts its chips back as the start has them and keeps the other families' changes; a chip flipped twice is no change", () => {
  // The start (your defaults) switched bash off; this chat switched it on, and write off; the web's search is the chat's too.
  const held = { "loop.tools": { bash: true, write: false }, "plugins.web.search": true };
  const { board, calls, card } = boardWith({ held });
  board.paint(answer({ flat: { ...answer().flat, ...held }, base: { "loop.tools": { bash: false }, "plugins.web.search": false } }));
  const family = (/** @type {string} */ label) => allWith(card("tools"), "nt-own-k").find((x) => textOf(x) === label);
  assert.deepEqual(allWith(card("tools"), "nt-own-k").map((x) => textOf(x)), ["Files", "Shell", "Web"]);
  buttonsOf(family("Shell"))[0].dispatch("click");
  assert.deepEqual(calls.pop(), ["set", "loop.tools", { bash: false, write: false }], "bash back to the start's off, Files' write kept");
  buttonsOf(family("Web"))[0].dispatch("click");
  assert.deepEqual(calls.pop(), ["unset", "plugins.web.search"]);
  // Files' ↺ with Shell already the start's: the whole change is gone.
  const files = boardWith({ held: { "loop.tools": { write: false } } });
  files.board.paint(answer({ flat: { ...answer().flat, "loop.tools": { write: false } }, base: { "loop.tools": null }, tools: { ...answer().tools, offered: answer().tools.offered.filter((n) => n !== "write"), off: ["write"] } }));
  const filesK = allWith(files.card("tools"), "nt-own-k").find((x) => textOf(x) === "Files");
  buttonsOf(filesK)[0].dispatch("click");
  assert.deepEqual(files.calls.pop(), ["unset", "loop.tools"]);
  // The chip itself, flipped back on: its name dropped, so nothing is held.
  allWith(files.card("tools"), "nt-chip").find((/** @type {any} */ c) => c.attrs["data-tool"] === "write").dispatch("click");
  assert.deepEqual(files.calls.pop(), ["unset", "loop.tools"]);
});

test("each card's head says at its end what its tile said: the value, a line more on its tooltip, greyed or orange as the tile was", () => {
  const { board, card } = boardWith();
  board.paint(answer({ tools: { ...answer().tools, off: ["agent"] } }));
  const tagOf = (/** @type {string} */ id) => allWith(card(id), "nt-card-tag")[0];
  assert.deepEqual(CARDS.map((id) => textOf(tagOf(id))), ["9 tools", "On · 3 memories", "2 on", "At 85% · ask me", "Off", "AGENTS.md"]);
  assert.equal(tagOf("memory").attrs.title, "recalled from your message");
  assert.equal(tagOf("subagents").classList.contains("is-warn"), true, "the agent tool off: orange");
});

// (fails before: yes — U5 phase 6: the bar was the Context card's)
test("the first request: what the model will get with your message, its figure of the window, the bar with the line notched, the parts in one line, and why it is orange or red", () => {
  const { board, el } = boardWith();
  board.paint(answer());
  const first = el.querySelector(".nt-first");
  assert.equal(textOf(first.querySelector(".nt-first-head")), "The first request|what Brain Model will get with your message — it grows as you type|10.2K| of 200K|compacts at 170K · 85%");
  assert.equal(textOf(first.querySelector(".nt-first-legend")), "Filament's agent prompt 3K|Instructions 400|Skills 120|Tools 5K|Memory up to 1.6K|Your message 12");
  assert.equal(textOf(first.querySelector(".nt-first-note")), "");
  board.paint(answer({ parts: [{ id: "prompt", tokens: 250000 }] }));
  assert.equal(first.querySelector(".nt-first-fig").classList.contains("is-error"), true);
  assert.equal(textOf(first.querySelector(".nt-first-note")), "Bigger than the window: the model would refuse it.");
});

// (fails before: yes — U5 phase 6: Works in was a chip in the sentence above the board)
test("Works in is the second question where the page gives its control: the control in the row, its line under it", () => {
  const control = fakeH("div", { class: "wi-ctl" });
  const line = fakeH("div", { class: "wi-line" });
  const { board, el } = boardWith({ worksIn: { control, line } });
  board.paint(answer());
  const ask = el.querySelector(".nt-ask");
  assert.deepEqual(ask.kids.map((/** @type {any} */ q) => q.attrs["aria-label"]), ["who", "where", "from"]);
  const where = el.querySelector(".nt-where");
  assert.equal(textOf(where.querySelector(".nt-q-k")), "Works in|where it changes files");
  assert.equal(where.querySelector(".wi-ctl"), control);
  assert.equal(where.querySelector(".wi-line"), line);
  assert.deepEqual(boardWith().el.querySelector(".nt-ask").kids.map((/** @type {any} */ q) => q.attrs["aria-label"]), ["who", "from"], "no control: no row");
});

// (fails before: yes — the owner's of 11-17: teams stood on every New Task board while untested and unfinished)
test("Who runs it is not asked while Settings › Experimental's Teams switch is off, and asked again once it is on", () => {
  let on = false;
  const { board, el } = boardWith({ teamsOn: () => on });
  const who = () => el.querySelector(".nt-ask").kids.find((/** @type {any} */ q) => q.attrs["aria-label"] === "who");
  board.paint(answer());
  assert.equal(hidden(who()), true, "off: the agent itself runs the task");
  on = true;
  board.paint(answer());
  assert.equal(hidden(who()), false);
  const bare = boardWith();
  bare.board.paint(answer());
  assert.equal(hidden(bare.el.querySelector(".nt-ask").kids.find((/** @type {any} */ q) => q.attrs["aria-label"] === "who")), false, "a host that says nothing of the switch asks it");
});

// (fails before: yes — the Tools card offered a Teams chip, on for a coding agent, while no chat had the team tool)
test("the Tools card says no team tool while Settings › Experimental's Teams switch is off: none on the loop, on a coding agent, or greyed on another engine", () => {
  let on = false;
  const { board, card } = boardWith({ teamsOn: () => on });
  const tools = (/** @type {any} */ a) => {
    board.paint(a);
    return {
      chip: allWith(card("tools"), "nt-chip").some((/** @type {any} */ c) => c.attrs["data-tool"] === "team" || c.attrs.title === "team"),
      head: textOf(card("tools")).includes("Teams beside"),
    };
  };
  const loop = answer({ tools: { ...answer().tools, off: ["team"] } });
  const agent = answer({ engine: { kind: "agent", model: "agent/claude" }, tools: { offered: [], off: [], adds: ["browser", "team", "flow"], hands: "own", memory: 0, recall: false, mcp: [] } });
  const chat = answer({ engine: { kind: "model", model: "brain-model" } });
  assert.deepEqual([tools(loop), tools(agent), tools(chat)], [{ chip: false, head: false }, { chip: false, head: false }, { chip: false, head: false }]);
  on = true;
  assert.deepEqual([tools(loop).chip, tools(agent).chip], [true, true]);
});

// ---- who runs the session (HarnessV4_Tasks E15 step 6, AG-173) -------------------------------------------------------

/** The members every shipped team has, as the answer names them. */
const FOUR = [
  { tag: "scout", name: "Scout", may: "read", place: "scout" },
  { tag: "builder", name: "Builder", may: "edit", place: "builder" },
  { tag: "tester", name: "Tester", may: "edit", place: "tester" },
  { tag: "reviewer", name: "Reviewer", may: "read", place: "reviewer" },
];
// Builders, the one shipped team that builds, and a team of yours.
const WHO_TEAMS = [
  { key: "builders", name: "Builders", line: "Builds it with its workers: planned, run in parallel where it can, each claim checked", shipped: true, check: null, lead: { tag: "buildlead", name: "Builders" }, members: FOUR },
  { key: "docs", name: "Docs", line: "Is it worth building, and what is the smallest version", shipped: false, check: null, lead: { tag: "pm", name: "PM" }, members: [FOUR[1], { tag: "translator", name: "Translator", may: "copy", place: null }] },
];
/** The answer's `who`: the agent itself unless told otherwise. @param {Record<string, any>} [o] */
const who = (o = {}) => ({ teams: WHO_TEAMS, asked: false, team: null, off: null, problem: null, ...o });
/** Why no team leads where Filament's loop does not run the model (its route's own upstream switched off). */
const LOOP_OFF = "Filament's agent loop does not run brain-model, and a team works on it";

// (fails before: yes — step 6: a session could be handed to a team only after its first message, on the Team tab)
test("whoRuns: the team that leads, whether a team may be picked, and the one line under the row", () => {
  assert.deepEqual(whoRuns(answer({ who: who() })), { team: null, off: false, why: "", warn: false });
  const led = whoRuns(answer({ who: who({ asked: true, team: "docs" }) }));
  assert.deepEqual([led.team?.key, led.team?.name, led.team?.lead.name, led.team?.members.map((m) => m.name), led.team?.icon, led.off, led.why, led.warn],
    ["docs", "Docs", "PM", ["Builder", "Translator"], "users", false, "", false]);
  // No team can lead this chat: the second choice is off, and the line says why (case 32).
  assert.deepEqual(whoRuns(answer({ who: who({ off: LOOP_OFF }) })), { team: null, off: true, why: `No team can lead this chat: ${LOOP_OFF}.`, warn: false });
  // The start asks for a team that cannot answer: the agent itself does, said in orange.
  assert.deepEqual(whoRuns(answer({ who: who({ asked: true, off: LOOP_OFF }) })), { team: null, off: true, why: `This start asks for a team, and the agent itself answers: ${LOOP_OFF}.`, warn: true });
  assert.deepEqual(whoRuns(answer({ who: who({ asked: true, problem: 'it names the team "gone", and there is no such team' }) })),
    { team: null, off: false, why: 'This start asks for a team, and the agent itself answers: it names the team "gone", and there is no such team.', warn: true });
  assert.deepEqual(whoRuns(null), { team: null, off: false, why: "", warn: false }, "before the first answer: the agent itself");
});

// (fails before: yes — step 6: the board had no row for who runs the session)
test("the first question asks who runs the session: the agent itself, or a lead with its team from the teams' menu — the two settings a hand-over writes, held", () => {
  /** @type {[any[], any][]} */
  const menus = [];
  const { board, calls, el } = boardWith({ menu: (items, o) => menus.push([items, o]) });
  board.paint(answer({ who: who() }));
  const row = el.querySelector(".nt-who");
  assert.equal(el.querySelector(".nt-ask").kids.indexOf(row), 0, "the first of the three questions");
  const seg = row.querySelector(".nt-who-seg");
  const [self, team] = buttonsOf(seg);
  assert.deepEqual([textOf(row.querySelector(".nt-q-k")), seg.attrs.role, seg.attrs["aria-label"], textOf(self), textOf(team)],
    ["Who runs it|one agent, or a lead and its team", "group", "Who runs it", "The agent itself", "A lead and its team"]);
  // Alone, its line names the model below and what the other choice is (the mock's words).
  assert.equal(textOf(row.querySelector(".nt-who-note")), "Brain Model — the model below. A lead plans and its workers do the work.");
  assert.deepEqual([self.attrs["aria-pressed"], self.classList.contains("is-on"), team.attrs["aria-pressed"], team.classList.contains("is-on"), "disabled" in team.attrs, team.attrs.title],
    ["true", true, "false", false, false, "Pick the team whose lead answers you"]);
  assert.deepEqual([hidden(row.querySelector(".nt-who-run")), textOf(row.querySelector(".nt-who-why")), textOf(row.querySelector(".nt-who-mark")), row.classList.contains("is-changed")], [true, "", "", false]);
  self.dispatch("click");
  assert.deepEqual(calls, [], "the agent itself already runs it: nothing to hold");
  team.dispatch("click");
  const [items, at] = /** @type {[any[], any]} */ (menus.at(-1));
  assert.equal(at.anchor, team);
  // (fails before: yes — the design pass of 10-24, UX6: the shipped teams in one run, each saying its crew again; the
  // owner's of 11-04: Builders drew a row per way its lead could lead) Builders is one row under They build.
  assert.deepEqual(items.map((i) => (i.type === "check" ? [i.label, i.desc, !!i.checked] : i.type === "label" ? i.label : i.type)), [
    "They build",
    ["Builders", "Builders leads Scout, Builder, Tester, Reviewer", false],
    "separator",
    "Yours",
    ["Docs", "PM leads Builder, Translator", false],
  ]);
  items.at(-1).onClick();
  assert.deepEqual(calls, [["set", "engine.mode", "team"], ["set", "engine.team", "docs"]]);
});

// (fails before: yes — step 6: nothing before the first message said who a team is)
test("with a team chosen the row names it: Run by its lead with its members; the agent itself drops the team and holds the model's own engine", () => {
  /** @type {[any[], any][]} */
  const menus = [];
  const held = /** @type {Record<string, any>} */ ({ "engine.mode": "team", "engine.team": "docs" });
  const { board, calls, el, pools } = boardWith({ held, menu: (items, o) => menus.push([items, o]) });
  board.paint(answer({ engine: { kind: "team", model: "brain-model", team: { key: "docs", name: "Docs" } }, who: who({ asked: true, team: "docs" }) }));
  const row = el.querySelector(".nt-who");
  const [self, team] = buttonsOf(row.querySelector(".nt-who-seg"));
  assert.deepEqual([textOf(team), team.attrs["aria-pressed"], team.classList.contains("is-on"), self.attrs["aria-pressed"], self.classList.contains("is-on"), team.attrs.title],
    ["Docs team", "true", true, "false", false, "PM leads Builder, Translator"]);
  const run = row.querySelector(".nt-who-run");
  assert.equal(hidden(run), false);
  // (fails before: yes — HarnessV4_Tasks E23-D6: Workers stood beside the team, "The crews' list" since U13; U13-D14 of
  // 10-20: a team's crew runs on the chat's list, its row on this board's Side agents card)
  assert.equal(textOf(run), "Run by PM, with Builder, Translator");
  // A choice held for this chat is marked as every other is: its dot, and ↺ back to who the start says (UX5).
  assert.equal(row.classList.contains("is-changed"), true);
  const whoBack = buttonsOf(row.querySelector(".nt-who-mark"))[0];
  assert.equal(whoBack.attrs["aria-label"], "Put back who runs it");
  whoBack.dispatch("click");
  assert.deepEqual(calls.splice(0), [["unset", "engine.mode"], ["unset", "engine.team"]]);
  assert.equal(pools.made.find((/** @type {any} */ c) => /crews/.test(String(c.io.label || ""))), undefined, "no crews' chip");
  // The menu checks the team that leads.
  team.dispatch("click");
  assert.deepEqual(/** @type {[any[], any]} */ (menus.at(-1))[0].filter((i) => i.type === "check").map((i) => !!i.checked), [false, true]);
  // Back to the agent itself.
  calls.length = 0;
  self.dispatch("click");
  assert.deepEqual(calls, [["unset", "engine.team"], ["set", "engine.mode", "model"]]);
  board.paint(answer({ who: who() }));
  assert.deepEqual([textOf(team), hidden(run), self.attrs["aria-pressed"]], ["A lead and its team", true, "true"]);
});

// (fails before: yes — step 6, cases 32 and 33)
test("a task no team can lead has its second choice off, with why; a team the start holds is marked as changed here; a coding agent's team reads as today", () => {
  const { board, calls, el } = boardWith();
  board.paint(answer({ engine: { kind: "model", model: "brain-model" }, who: who({ off: LOOP_OFF }) }));
  const row = el.querySelector(".nt-who");
  const [self, team] = buttonsOf(row.querySelector(".nt-who-seg"));
  const why = row.querySelector(".nt-who-why");
  assert.deepEqual(["disabled" in team.attrs, team.attrs.title, textOf(why), why.classList.contains("is-warn"), why.attrs.role],
    [true, `No team can lead this chat: ${LOOP_OFF}.`, `No team can lead this chat: ${LOOP_OFF}.`, false, "status"]);
  // A start that asks for a team no team can answer: the agent itself answers, said in orange, and one click settles it.
  board.paint(answer({ engine: { kind: "model", model: "brain-model" }, sources: { "engine.mode": "session", "engine.team": "session" }, who: who({ asked: true, off: LOOP_OFF }) }));
  assert.deepEqual([textOf(why), why.classList.contains("is-warn"), self.attrs["aria-pressed"]], [`This start asks for a team, and the agent itself answers: ${LOOP_OFF}.`, true, "true"]);
  self.dispatch("click");
  assert.deepEqual(calls, [["unset", "engine.team"], ["set", "engine.mode", "model"]]);
  // A team the start holds leads: the mark says it changed here; the team can be picked again.
  board.paint(answer({ engine: { kind: "team", model: "brain-model", team: { key: "builders", name: "Builders" } }, sources: { "engine.mode": "session", "engine.team": "session" }, who: who({ asked: true, team: "builders" }) }));
  assert.deepEqual(["disabled" in team.attrs, textOf(team), textOf(row.querySelector(".nt-who-mark")), textOf(why)], [false, "Builders team", "changed here", ""]);
  assert.equal(textOf(row.querySelector(".nt-who-by")), "Run by Builders, with Scout, Builder, Tester, Reviewer");
  // A coding agent that leads (case 33): the Context card's sentence stays its own.
  const coder = boardWith();
  coder.board.paint(answer({ engine: { kind: "agent", model: "coder-one", team: { key: "builders", name: "Builders" } }, who: who({ asked: true, team: "builders" }) }));
  assert.match(textOf(coder.card("context")), /Team Builders leads this chat, its lead the coding agent coder-one: it builds its own context, and Filament adds its lead's part and its team's tools/);
  assert.equal(textOf(coder.el.querySelector(".nt-who-by")), "Run by Builders, with Scout, Builder, Tester, Reviewer");
});

// (fails before: yes — d-side, 11-12: a start whose team changes no file said who runs it — "Run by BugHunters, with
// Hunter, Checker" — and nothing of reading: the server holds every turn such a team leads to reading, whatever the
// mode the Tools card below it shows)
test("a team that changes no file chosen to run the chat: the line under the row says, before the first send, that the chat only reads while it is in charge; a team that builds, and one of yours whose workers all read, say nothing there", () => {
  const READ = { may: "read", place: "reviewer" };
  const teams = [
    ...WHO_TEAMS,
    { key: "bughunters", name: "BugHunters", line: "Finds bugs and checks claims, fixing nothing", shipped: true, readOnly: true, check: null, lead: { tag: "huntlead", name: "BugHunters" }, members: [{ tag: "hunter", card: "reviewer", name: "Hunter", ...READ }, { tag: "checker", card: "reviewer", name: "Checker", ...READ }] },
    { key: "readers", name: "Readers", line: "", shipped: false, readOnly: false, check: null, lead: { tag: "product", name: "Product" }, members: [{ tag: "reviewer", name: "Reviewer", ...READ }] },
  ];
  const READS = "The chat only reads while it is in charge, whatever its mode: BugHunters changes no file.";
  /** @param {string | null} team */
  const led = (team) => answer({ engine: team ? { kind: "team", model: "brain-model", team: { key: team, name: team } } : { kind: "loop", model: "brain-model" }, who: who({ teams, asked: !!team, team }) });
  const hunt = whoRuns(led("bughunters"));
  assert.deepEqual([hunt.team?.name, hunt.off, hunt.why, hunt.warn], ["BugHunters", false, READS, false], "said, and no warning: it is what the team is");
  assert.deepEqual([whoRuns(led("builders")).why, whoRuns(led("readers")).why, whoRuns(led(null)).why], ["", "", ""], "a team that builds; one whose workers all read, which nothing holds; the agent itself");
  // What goes before it stands: no team can lead, or the start asks for one that cannot answer.
  assert.equal(whoRuns(answer({ who: who({ teams, off: LOOP_OFF }) })).why, `No team can lead this chat: ${LOOP_OFF}.`);
  // On the board: under Run by, in the row's quiet line — never in orange.
  const { board, el } = boardWith();
  board.paint(led("bughunters"));
  const row = el.querySelector(".nt-who");
  const why = row.querySelector(".nt-who-why");
  assert.deepEqual([textOf(row.querySelector(".nt-who-by")), textOf(why), why.classList.contains("is-warn"), why.attrs.role], ["Run by BugHunters, with Hunter, Checker", READS, false, "status"]);
  assert.equal(buttonsOf(row.querySelector(".nt-who-seg"))[1].attrs.title, "BugHunters leads Hunter, Checker", "the team's button says who leads whom, as before");
  board.paint(led("builders"));
  assert.deepEqual([textOf(row.querySelector(".nt-who-by")), textOf(why)], ["Run by Builders, with Scout, Builder, Tester, Reviewer", ""]);
  board.paint(led("readers"));
  assert.deepEqual([textOf(row.querySelector(".nt-who-by")), textOf(why)], ["Run by Product, with Reviewer", ""]);
  board.paint(led(null));
  assert.equal(textOf(why), "");
});

// ---- the host's wiring ---------------------------------------------------------------------------------------------

// (fails before: yes — AH-D3: the empty state opened "Customize this start", the shared editor over the draft's every
// knob, read from POST /sessions/draft-settings)
test("the empty state mounts no settings editor and asks for no draft settings (AH-D3)", () => {
  assert.doesNotMatch(read("src/ui/harness/conversation/empty.js"), /Customize this start|settingsEditor|draft-settings|openAll/);
});

test("the host asks with the first send's own body (NT-D6) plus the draft, keeps only the newest answer, and the page tells it what moved", () => {
  const empty = read("src/ui/harness/conversation/empty.js");
  assert.match(empty, /api\("\/sessions\/draft-start", \{ method: "POST", body: \{ \.\.\.body, text: cb\.start\.text\(\) \} \}\)/);
  assert.match(empty, /if \(mine !== asked \|\| chat\(\) !== c \|\| cb\.getFolder\(\) !== folder \|\| c\.chainId \|\| viewOnly\(\)\) return;/, "an answer for a chat or folder the page left is dropped, and one a view-only page would show");
  assert.doesNotMatch(empty, /preset-card|paintPresets/, "the preset cards are gone (NT-D3), and the presets with them (the owner's of 11-07)");
  const app = read("src/ui/harness/app.js");
  const sends = [...app.matchAll(/sessionStartBody\(chat, ([^,]+), [^;]*composer\.heldSettings\(\)\)/g)].map((m) => m[1]);
  assert.deepEqual(sends, ["folder", "chat.cwd"], "the board's body and the create call's are the one builder over the same held choices");
  // (fails before: yes — the design pass of 10-24: a chat started in a folder left the chooser where it was, so the
  // board weighed the chooser's folder while the send used the chat's)
  // A chat with no folder named takes its project's own first (the owner's of 11-08; new-chat-menu-fold.test.js).
  assert.match(app, /function newChat\(\{ cwd = null, model = null, worksIn = null, held = null \} = \{\}\) \{\n(?:  \/\/[^\n]*\n)+  const carried = [^\n]*\n  const placed = [^\n]*\n  if \(cwd == null\) cwd = placed \?\? null;\n(?:  \/\/[^\n]*\n)+  const into = String\(cwd \?\? ""\)\.trim\(\);\n  if \(into && into !== folderIn\.value\.trim\(\)\) \{\n    folderIn\.value = into;\n    folderIn\.dispatchEvent\(new Event\("input"\)\);/, "a chat started in a folder moves the chooser there");
  assert.match(app, /onHeldChange: \(\) => transcript\.startChanged\(\)/);
  assert.match(app, /if \(!chatOf\(state\.currentId\)\?\.chainId\) transcript\.startChanged\(\);/, "the draft's estimate moves the board of an unborn chat only");
  const composer = read("src/ui/harness/composer/composer.js");
  assert.equal(composer.match(/cb\.onHeldChange\?\.\(\);/g)?.length, 2, "a held tuning change (pick, reset) tells the page");
});
