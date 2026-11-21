// @ts-check
// A sub-agent's card draws its calls' rows only while it stands open (render.js `placeCalls`, the owner's of 11-17: a
// chat window following a 22-hour turn reached 13 GB). A lead's cards drew every call of every sub-agent into cards
// nobody opened — 25,649 of the turn's 26,627 rows, in the lab — and the turn's kept rows (`DrawnRows`) held each. Opened,
// a card draws them all, and keeps drawing them as its sub-agent works; closed, it lets them go, out of the kept rows
// too. Find still finds a word in a closed card's calls: the cards whose calls' records hold it draw their rows for the
// search (`revealCalls`), and let them go as the bar closes (`foldCalls`).
// (fails before: yes — a closed card drew every row of its calls at each drawing, and the turn kept them)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows, revealCalls, foldCalls } from "../src/ui/harness/conversation/tools/render.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => doc.restore());

/** A call its sub-agent made and ended. @param {string} parent @param {string} id @param {string} name @param {string} subject */
const call = (parent, id, name, subject) => [
  { type: "subagent-tool-start", round: 1, parent, id, name, args: subject, card: { kind: name === "bash" ? "shell" : "read", title: name === "bash" ? "Run" : "Read", subject } },
  { type: "subagent-tool-end", round: 1, parent, id, name, ok: true, ms: 3, chars: 2, preview: "ok" },
];
/** Two sub-agents' cards: Filament's own (its card stands over the lines of what it drew) and a coding agent's. */
const EVENTS = [
  { type: "round-start", round: 1 },
  { type: "tool-start", round: 1, id: "a1", name: "agent", args: { brief: "map the parser" } },
  { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", exchange: 0, description: "map the parser", agent: "scout" },
  ...call("a1", "r1", "read", "lexer.js"),
  ...call("a1", "r2", "read", "parser.js"),
  ...call("a1", "r3", "read", "ast.js"),
  ...call("a1", "b1", "bash", "npm test"),
  { type: "tool-start", round: 1, id: "t1", name: "Task", args: "Check the docs", card: { kind: "subagent", title: "Task", subject: "Check the docs" } },
  { type: "subagent-start", round: 1, parent: "t1", description: "Check the docs" },
  ...call("t1", "d1", "read", "README.md"),
];
/** @param {any[]} evs @param {Map<string, any>} drawn */
const draw = (evs, drawn) => roundRows(alignEvents(evs).byRound.get(1), { drawn, live: true });
/** The card's row: Filament's own agent's stands over the lines of what it drew. @param {any} el */
const foldOf = (el) => (el.classList.contains("sub-drew") ? el.children[0] : el);
/** The rows in a card's list of calls. @param {any} el @returns {any[]} */
const callRows = (el) => el.querySelector('.tool-children[data-key="calls"]')?.querySelectorAll(".tool-row") || [];
/** The kept rows of calls inside the cards. @param {Map<string, any>} drawn */
const keptInside = (drawn) => [...drawn.keys()].filter((k) => !/^call:(a1|t1)$/.test(k)).sort();
/** A press on a card's row that opens or closes it. @param {any} fold @param {boolean} open */
const press = (fold, open) => {
  fold.querySelector("summary").dispatch("click");
  fold.open = open;
  fold.dispatch("toggle");
};

test("a closed card draws none of its calls' rows and keeps none; opened, every one, its new calls with it; closed, it lets them go", () => {
  const drawn = new Map();
  const [card] = draw(EVENTS, drawn);
  const fold = foldOf(card);
  assert.equal(fold.open, false);
  assert.equal(callRows(card).length, 0, "closed: no rows of its calls");
  assert.deepEqual(keptInside(drawn), [], "and none kept");
  assert.match(String(fold.querySelector("summary").textContent), /4 tool uses/, "its line counts them still");
  press(fold, true);
  const words = () => callRows(card).map((r) => String(r.textContent)).join(" | ");
  for (const f of ["lexer.js", "parser.js", "ast.js", "npm test"]) assert.ok(words().includes(f), `opened: ${f}'s row`);
  assert.ok(keptInside(drawn).length >= 4, "kept while it stands open");
  // Drawn again while open, a new call of its sub-agent: its row too.
  const more = [...EVENTS, { type: "subagent-tool-start", round: 1, parent: "a1", id: "g1", name: "grep", args: "tokens", card: { kind: "search", title: "Search", subject: "tokens" } }];
  const [again] = draw(more, drawn);
  assert.equal(again, card, "the card that stood");
  assert.equal(fold.open, true, "open still");
  assert.ok(words().includes("tokens"), "its new call's row");
  press(fold, false);
  assert.equal(callRows(card).length, 0, "closed: its rows let go");
  assert.deepEqual(keptInside(drawn), [], "out of the kept rows too");
  // Its sub-agent works on while it stands closed: still none.
  draw([...more, { type: "subagent-tool-end", round: 1, parent: "a1", id: "g1", name: "grep", ok: true, ms: 3, chars: 2, preview: "ok" }], drawn);
  assert.deepEqual([fold.open, callRows(card).length, keptInside(drawn)], [false, 0, []]);
});

// (fails before: yes — Fable 5.2's review of 11-17: Find matched the records' JSON, where a Windows path's backslashes
// are doubled; the rows it built went at the card's next drawing, its marks with them; a toggle built rows already
// there again; two characters built nearly every card, kept until the bar closed)
test("Find matches a record's words as written, keeps the rows it built through the card's drawings, builds from three characters and lets go of the cards its words leave", () => {
  const drawn = new Map();
  const root = /** @type {any} */ (doc.document.createElement("div"));
  const evs = [...EVENTS, ...call("a1", "w1", "read", "H:\\Northwind\\el-wt\\ship.js")];
  const [own, task] = draw(evs, drawn);
  root.append(own, task);
  assert.equal(revealCalls(root, "re"), 0, "two characters build none");
  assert.equal(revealCalls(root, "northwind\\el-wt"), 1, "a path with its backslashes, as written");
  const rows = callRows(own);
  assert.ok(rows.length > 0);
  // Its sub-agent works on: the card is drawn again, closed, and keeps the rows Find holds.
  const more = [...evs, ...call("a1", "w2", "read", "notes.md")];
  draw(more, drawn);
  assert.equal(foldOf(own).open, false);
  assert.ok(callRows(own).length > rows.length, "kept through the drawing, its new call's row with them");
  // Find opens the card at its match: the rows standing are kept, not built anew.
  const first = callRows(own)[0];
  foldOf(own).open = true;
  foldOf(own).dispatch("toggle");
  assert.equal(callRows(own)[0], first, "the same rows");
  foldOf(own).open = false;
  foldOf(own).dispatch("toggle");
  assert.ok(callRows(own).length > 0, "closed again while Find holds them: kept");
  // Words that leave it: its rows go; a word of the other card's builds that one's.
  assert.equal(revealCalls(root, "readme"), 1);
  assert.deepEqual([callRows(own).length > 0, callRows(task).length > 0], [false, true]);
  foldCalls(root);
  assert.deepEqual([callRows(own).length, callRows(task).length], [0, 0], "the bar closed: all let go");
  draw(more, drawn);
  assert.equal(callRows(own).length, 0, "and a drawing after builds none");
});

// (fails before: yes — the review of 11-19: Find's words met a call's ids, its clock, its sizes, its pictures' names and
// the state no row says, so a common word of three letters built nearly every closed card's rows)
test("Find's words meet what a call's row draws: never its ids, its clock, its sizes, its pictures' names or the state no row says", () => {
  const drawn = new Map();
  const root = /** @type {any} */ (doc.document.createElement("div"));
  const evs = [
    { type: "round-start", round: 1 },
    { type: "tool-start", round: 1, id: "a1", name: "agent", args: { brief: "look" } },
    { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", exchange: 0, description: "look", agent: "scout" },
    { type: "subagent-tool-start", round: 1, parent: "a1", id: "toolu_01QxZ", name: "read", args: "lexer.js", card: { kind: "read", title: "Read", subject: "lexer.js" }, ts: 1763512345678 },
    { type: "subagent-tool-end", round: 1, parent: "a1", id: "toolu_01QxZ", name: "read", ok: true, ms: 4321, chars: 9876, preview: "ok", requestId: "req_cafe42", images: [{ ref: "addbeef0", mediaType: "image/png" }] },
    { type: "subagent-tool-start", round: 1, parent: "a1", id: "toolu_02", name: "bash", args: "rm -rf x", card: { kind: "shell", title: "Run", subject: "rm -rf x" } },
    { type: "subagent-tool-end", round: 1, parent: "a1", id: "toolu_02", name: "bash", refused: true, ok: false },
    { type: "subagent-tool-start", round: 1, parent: "a1", id: "toolu_03", name: "task_get", args: { id: "task-zeta" }, card: { kind: "read", title: "Task", subject: "a task" } },
    { type: "subagent-tool-end", round: 1, parent: "a1", id: "toolu_03", name: "task_get", ok: true, ms: 1, chars: 2, preview: "ok" },
    { type: "subagent-tool-start", round: 1, parent: "a1", id: "toolu_04", name: "read", args: "shot.png", card: { kind: "read", title: "Read", subject: "shot.png" } },
    { type: "subagent-tool-end", round: 1, parent: "a1", id: "toolu_04", name: "read", ok: true, ms: 1, chars: 2, preview: "ok", imagesNotKept: { count: 2, why: "the log's quota was full" } },
  ];
  const cards = draw(evs, drawn);
  root.append(...cards);
  for (const w of ["too", "olu", "req", "caf", "432", "987", "763", "add", "bee", "one"]) assert.equal(revealCalls(root, w), 0, `${w}: in no row`);
  assert.equal(revealCalls(root, "refused"), 1, "the state a row says");
  foldCalls(root);
  assert.equal(revealCalls(root, "lexer"), 1, "what a row draws, as ever");
  foldCalls(root);
  assert.equal(revealCalls(root, "zeta"), 1, "a field of a call's args, whatever its name: searched as ever");
  foldCalls(root);
  assert.equal(revealCalls(root, "quota"), 1, "why its pictures were not kept, which its row says");
  foldCalls(root);
});

test("Find draws the rows of the closed cards whose calls hold its words, closed still, and lets them go as it closes", () => {
  const drawn = new Map();
  const root = /** @type {any} */ (doc.document.createElement("div"));
  const cards = draw(EVENTS, drawn);
  root.append(...cards);
  const [own, task] = cards;
  assert.equal(revealCalls(root, "nothing like it"), 0, "no card holds it: none drawn");
  assert.deepEqual([callRows(own).length, callRows(task).length], [0, 0]);
  assert.equal(revealCalls(root, "lexer"), 1, "the card whose calls hold it");
  assert.ok(callRows(own).some((r) => String(r.textContent).includes("lexer.js")), "its rows, the word among them");
  assert.deepEqual([foldOf(own).open, callRows(task).length], [false, 0], "closed still — Find opens the one its match is in — and the other card draws none");
  assert.equal(revealCalls(root, "readme"), 1, "a word of the other's: that one, the first drawn already");
  assert.ok(callRows(task).length > 0);
  // Find opened the coding agent's card at its match; the bar closes.
  foldOf(task).open = true;
  foldOf(task).dispatch("toggle");
  foldCalls(root);
  assert.equal(callRows(own).length, 0, "the closed card lets its rows go");
  assert.ok(callRows(task).length > 0, "the one opened keeps them");
  assert.deepEqual(keptInside(drawn).filter((k) => /r1|r2|r3|b1/.test(k)), [], "and nothing keeps the closed card's");
  // The bar asks for them before each search, and lets them go as it closes; the transcript's are drawn.
  const find = readFileSync("src/ui/harness/find.js", "utf8");
  assert.match(find, /const needle = q\.toLowerCase\(\);\n\s*cb\.reveal\?\.\(needle\);/);
  assert.match(find, /const close = \(\) => \{ clear\(\); cb\.letGo\?\.\(\); bar\.classList\.add\("hidden"\); \};/);
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(timeline, /revealWork\(needle\) \{\n\s*revealCalls\(inner, needle\);/);
  assert.match(timeline, /foldWork\(\) \{\n\s*findOpen = false;\n\s*foldCalls\(inner\);/);
});
