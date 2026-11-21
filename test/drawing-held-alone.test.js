// @ts-check
// What a drawing leaves on the page holds what it names alone (the lab's of 11-17, a window following a 22-hour turn):
// a sub-agent's card drawn again is drawn into the card that stands, and the card it built to do that is let go of. The
// press that opens its conversation was made in `subagentRow`, beside the closure that placed the drawing's list of
// calls, and held that whole scope — the list, and the card it stood in, prompt, report and all — so every card on the
// page kept a dead twin of itself; 19,370 of a hidden window's 19,604 detached nodes went that way. A turn's folds heard
// their toggle with a listener closing over the view they were first drawn for, which kept that view and every row it
// drew (timeline.js `showCopies`).
// (fails before: yes — the twin's elements stayed reachable through the button's handler)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";

v8.setFlagsFromString("--expose-gc");
const gc = /** @type {() => void} */ (vm.runInNewContext("gc"));

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {any} */
let hadOpen;
before(() => {
  doc = stubDocument();
  hadOpen = chipActions.openSubagent;
  chipActions.openSubagent = () => {};
});
after(() => {
  chipActions.openSubagent = hadOpen;
  doc.restore();
});

const EVENTS = [
  { type: "round-start", round: 1 },
  { type: "tool-start", round: 1, id: "a1", name: "agent", args: { brief: "map the parser" } },
  { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", exchange: 0, description: "map the parser", agent: "scout", prompt: "Map the parser and say where it reads ahead." },
  { type: "subagent-tool-start", round: 1, parent: "a1", id: "r1", name: "read", args: "lexer.js", card: { kind: "read", title: "Read", subject: "lexer.js" } },
  { type: "subagent-tool-end", round: 1, parent: "a1", id: "r1", name: "read", ok: true, ms: 3, chars: 2, preview: "ok" },
];

test("a sub-agent's card drawn again keeps nothing of the card it built to draw it: its press holds the agent's id alone", async () => {
  const drawn = new Map();
  /** @param {any[]} evs */
  const draw = (evs) => roundRows(alignEvents(evs).byRound.get(1), { drawn, live: true });
  const [card] = draw(EVENTS);
  assert.ok(card.querySelector(".subagent-open"), "the card has its Open conversation press");
  /** @type {WeakRef<object>[]} */
  const made = [];
  const create = doc.document.createElement;
  doc.document.createElement = (tag) => {
    const el = create(tag);
    made.push(new WeakRef(el));
    return el;
  };
  let again;
  try {
    [again] = draw([...EVENTS, { type: "subagent-end", round: 1, parent: "a1", agentId: "sa_1", state: "done", report: "It reads one token ahead.", ms: 1200 }]);
  } finally {
    doc.document.createElement = create;
  }
  assert.equal(again, card, "drawn into the card that stands");
  assert.ok(made.length > 10, "the drawing built a card of its own to draw it from");
  /** The elements of that drawing nothing on the page holds: the card's own are its. */
  const loose = () => made.filter((r) => { const el = r.deref(); return el && !card.contains(el); }).length;
  for (let i = 0; i < 6 && loose(); i++) {
    await new Promise((r) => setTimeout(r, 20));
    gc();
  }
  assert.equal(loose(), 0, "every element the drawing built and left off the page is let go of");
});

// (fails before: yes — the lab's of 11-17, a live window at 68k events: a group's toggle, made in `roundRows`, held the
// box its newest drawing made and dropped, 285 of the 338 detached nodes left)
test("a group of calls drawn again keeps nothing of the group it built to draw it: its toggle holds its key alone", async () => {
  const drawn = new Map();
  const read = (/** @type {string} */ id, /** @type {string} */ subject) => [
    { type: "tool-start", round: 1, id, name: "read", args: subject, card: { kind: "read", title: "Read", subject } },
    { type: "tool-end", round: 1, id, name: "read", ok: true, ms: 3, chars: 2, preview: "ok" },
  ];
  const evs = [{ type: "round-start", round: 1 }, ...read("g1", "lexer.js"), ...read("g2", "parser.js"), { type: "tool-start", round: 1, id: "g3", name: "read", args: "ast.js", card: { kind: "read", title: "Read", subject: "ast.js" } }];
  /** @param {any[]} e */
  const draw = (e) => roundRows(alignEvents(e).byRound.get(1), { drawn, live: true });
  const [group] = draw(evs);
  assert.ok(group.querySelector(".tool-children"), "the three reads drawn as one group");
  /** @type {WeakRef<object>[]} */
  const made = [];
  const create = doc.document.createElement;
  doc.document.createElement = (tag) => {
    const el = create(tag);
    made.push(new WeakRef(el));
    return el;
  };
  let again;
  try {
    [again] = draw([...evs, { type: "tool-end", round: 1, id: "g3", name: "read", ok: true, ms: 3, chars: 2, preview: "ok" }]);
  } finally {
    doc.document.createElement = create;
  }
  assert.equal(again, group, "drawn into the group that stands");
  const loose = () => made.filter((r) => { const el = r.deref(); return el && !group.contains(el); }).length;
  for (let i = 0; i < 6 && loose(); i++) {
    await new Promise((r) => setTimeout(r, 20));
    gc();
  }
  assert.equal(loose(), 0, "every element the drawing built and left off the page is let go of");
});

// (fails before: yes — Fable 5.2's review of 11-17: a row's ⌘ press, made in `toolRow`, held the row's options and its
// body, and the call's prompt shown, made in `stubOf`, that drawing's scope)
test("a call's row with its prompt drawn again keeps nothing of the row it built to draw it", async () => {
  const drawn = new Map();
  const start = { type: "tool-start", round: 1, id: "c1", name: "bash", args: { command: "npm test" }, card: { kind: "shell", title: "Run", subject: "npm test" } };
  const end = (/** @type {string} */ preview) => ({ type: "tool-end", round: 1, id: "c1", requestId: "req-1", name: "bash", ok: true, ms: 1200, chars: preview.length, preview });
  /** @param {any[]} e */
  const draw = (e) => roundRows(alignEvents(e).byRound.get(1), { drawn, live: true, onPrompt: () => {} });
  const [row] = draw([{ type: "round-start", round: 1 }, start, end("40 passed")]);
  assert.ok(row.querySelector(".tool-prompt"), "its ⌘");
  /** @type {WeakRef<object>[]} */
  const made = [];
  const create = doc.document.createElement;
  doc.document.createElement = (tag) => {
    const el = create(tag);
    made.push(new WeakRef(el));
    return el;
  };
  let again;
  try {
    [again] = draw([{ type: "round-start", round: 1 }, start, end("40 passed, 2 skipped")]);
  } finally {
    doc.document.createElement = create;
  }
  assert.equal(again, row, "drawn into the row that stands");
  const loose = () => made.filter((r) => { const el = r.deref(); return el && !row.contains(el); }).length;
  for (let i = 0; i < 6 && loose(); i++) {
    await new Promise((r) => setTimeout(r, 20));
    gc();
  }
  assert.equal(loose(), 0, "every element the drawing built and left off the page is let go of");
});

test("a fold's toggle asks the view that drew it last, and holds none itself", () => {
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  const body = timeline.slice(timeline.indexOf("function showCopies(v) {"), timeline.indexOf("/** A text block's DOM"));
  assert.match(body, /copiesOf\.set\(f, v\);/, "each drawing names itself the fold's view");
  assert.match(body, /addEventListener\("toggle", copiesToggled\)/, "heard by the module's one handler");
  assert.doesNotMatch(body, /addEventListener\("toggle", \(/, "no listener made beside a view");
  assert.match(timeline, /const copiesToggled = \([^)]*\) => \{\s+const v = copiesOf\.get\(/, "the handler reads the fold's newest view");
});

// (fails before: yes — Fable 5.2's review of 11-17: a turn's pictures strip drawn where it never showed, under open
// folds or its chat under the Plan, kept the watch that waits for its size, and the watch kept it and its turn's drawing)
test("a pictures strip off the page has its size's watch ended: as a strip is replaced, and as a chat is drawn anew", () => {
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  const sweep = timeline.slice(timeline.indexOf("function letStripsGo() {"), timeline.indexOf("function shotsToNewest("));
  assert.match(sweep, /for \(const w of stripWatches\)\s+if \(!w\.strip\.isConnected\) \{\s+w\.watch\.disconnect\(\);\s+stripWatches\.delete\(w\);/);
  assert.match(timeline, /const w = \{ strip, watch \};\s+stripWatches\.add\(w\);\s+watch\.observe\(strip\);/, "every watch is counted");
  assert.match(timeline, /watch\.disconnect\(\);\s+stripWatches\.delete\(w\);\s+\}\);/, "and uncounted as it ends");
  assert.match(timeline, /v\.shots\?\.remove\(\);\s+v\.shots = pics\.length \? pictureStrip\(pics\) : null;\s+letStripsGo\(\);/, "a strip replaced");
  assert.match(timeline, /render\(c\) \{[^]{0,900}?inner\.replaceChildren\(loadEarlier\);\s+letStripsGo\(\);/, "a chat drawn anew, its old turns off the page");
});
