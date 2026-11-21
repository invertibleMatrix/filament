// @ts-check
// The transcript's cards drawn again as a turn runs keep the elements under the pointer (the owner's of 11-01: "when i
// hover over my mouse over some interactive elements like buttons then those are just suppose to highlight only once
// they quite a lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have
// to press more than once"). A running turn draws its rounds again at every run event: a running command's row was made
// anew at each line of its output, a group's and a helper's card at each new call, and the card of an agent the main
// agent asked at every event and at every word of the agents' list — each a new element under a resting pointer, whose
// hover started over and where a press that began on the old one never clicked. Drawn into the row that stands
// (render.js `drawInto`, dom.js `morph`), a row is the element that stood, its words and its handlers the newest draw's;
// a card that paints its own parts is the one that stands, painted again (agent-card.js `askedCardAgain`).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => doc.restore());

/** The round's rows. @param {any[]} events @param {object} [o] @returns {any[]} */
const rows = (events, o = {}) => roundRows(alignEvents(events).byRound.get(1), o);
/** A command that ran and ended. @param {string} id */
const ran = (id) => [
  { type: "tool-start", round: 1, name: "bash", args: id, id, input: { command: id } },
  { type: "tool-end", round: 1, name: "bash", ok: true, ms: 5, id, chars: 2, preview: "ok", exitCode: 0 },
];
/** Some of `chipActions` set for one test, put back after it. @param {Partial<typeof chipActions>} set @param {() => Promise<void> | void} fn */
const withActions = async (set, fn) => {
  const had = Object.fromEntries(Object.keys(set).map((k) => [k, /** @type {any} */ (chipActions)[k]]));
  Object.assign(chipActions, set);
  try {
    await fn();
  } finally {
    Object.assign(chipActions, had);
  }
};

// (fails before: yes — a running command's record moved at each line of its output, and its row was made anew: its line,
// its Run in background and its output new elements at every event)
test("a running command's row drawn again as its output grows is the row that stood, and its Run in background acts on the button that stands", async () => {
  /** @type {string[]} */
  const sent = [];
  /** @type {(why: string | null) => void} */
  let answer = () => {};
  await withActions({ toBackground: (runId, callId) => (sent.push(`${runId}/${callId}`), new Promise((r) => { answer = r; })) }, async () => {
    const drawn = new Map();
    const out = (/** @type {number} */ n) => ({ type: "tool-output", round: 1, id: "b1", text: `line ${n}\n` });
    /** @type {any[]} */
    const evs = [{ type: "round-start", round: 1 }, { type: "tool-start", round: 1, name: "bash", args: "npm test", id: "b1", input: { command: "npm test" }, movable: true, ts: Date.now() - 10_000 }, out(1)];
    const [first] = rows(evs, { drawn, runId: "run-1", live: true });
    const summary = first.querySelector("summary");
    const btn = first.querySelector(".tool-bg");
    assert.ok(btn && !btn.classList.contains("hidden"), "past five seconds its row offers Run in background");
    evs.push(out(2));
    const [again] = rows(evs, { drawn, runId: "run-1", live: true });
    assert.equal(again, first, "the row that stood");
    assert.equal(again.querySelector("summary"), summary, "its line under the pointer too");
    assert.equal(again.querySelector(".tool-bg"), btn, "and its button");
    assert.match(String(again.querySelector(".term-out")?.textContent), /line 1\nline 2/, "its output the newest");
    btn.dispatch("click");
    assert.deepEqual(sent, ["run-1/b1"]);
    assert.equal(btn.textContent, "Sending…", "the button that stands says it is sent");
    // Drawn again while the move is on its way: it says so still, and is not pressed twice.
    evs.push(out(3));
    rows(evs, { drawn, runId: "run-1", live: true });
    assert.equal(first.querySelector(".tool-bg"), btn);
    assert.deepEqual([btn.textContent, btn.hasAttribute("disabled") || btn.disabled === true], ["Sending…", true]);
    // Refused: pressable again, and drawn so.
    answer("the command already ended");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([btn.textContent, btn.disabled], ["Run in background", false]);
    evs.push(out(4));
    rows(evs, { drawn, runId: "run-1", live: true });
    assert.deepEqual([btn.textContent, btn.hasAttribute("disabled")], ["Run in background", false]);
  });
});

// (fails before: yes — a group that gained a row was made anew, its line under the pointer a new element)
test("a group that gains a row is the group that stood, its line and its rows the ones on the page", () => {
  const drawn = new Map();
  /** @type {any[]} */
  const evs = [{ type: "round-start", round: 1 }, ...ran("a"), ...ran("b")];
  const [group] = rows(evs, { drawn });
  const summary = group.querySelector("summary");
  const [a, b] = group.querySelector(".tool-children").children;
  assert.match(String(summary.textContent), /2 commands/);
  evs.push(...ran("c"));
  const [again] = rows(evs, { drawn });
  assert.equal(again, group, "the group that stood");
  assert.equal(again.querySelector("summary"), summary, "its line too");
  assert.match(String(summary.textContent), /3 commands/, "saying the newest");
  const kids = again.querySelector(".tool-children").children;
  assert.deepEqual([kids.length, kids[0], kids[1]], [3, a, b], "its rows the ones that stood, the new one after them");
  // Opened by the person, it stays open as it is drawn again.
  group.querySelector("summary").dispatch("click");
  group.open = true;
  group.dispatch("toggle");
  evs.push(...ran("d"));
  const [opened] = rows(evs, { drawn });
  assert.deepEqual([opened, opened.open], [group, true]);
});

// (fails before: yes — a helper's card was made anew at each of its calls: its line, its Open conversation and the
// list of its calls new elements, its calls' rows moved into the new list)
test("a helper's card drawn again at each of its calls is the card that stood, its Open conversation and its calls' rows with it", async () => {
  /** @type {string[]} */
  const opened = [];
  await withActions({ openSubagent: (id) => void opened.push(id) }, () => {
    const drawn = new Map();
    const call = (/** @type {string} */ id) => [
      { type: "subagent-tool-start", round: 1, parent: "a1", id, name: "read", args: `${id}.js`, card: { kind: "read", title: "Read", subject: `${id}.js` } },
      { type: "subagent-tool-end", round: 1, parent: "a1", id, name: "read", ok: true, ms: 3, chars: 9, preview: "x" },
    ];
    /** @type {any[]} */
    const evs = [
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, id: "a1", name: "agent", args: { brief: "look around" } },
      { type: "subagent-start", round: 1, parent: "a1", agentId: "sub-1", exchange: 0, description: "look around", agent: "scout" },
      ...call("r1"),
    ];
    const [first] = rows(evs, { drawn, live: true });
    const row = first.querySelector("details");
    const open = first.querySelector(".subagent-open");
    // Closed, it builds no rows of its calls (render.js `placeCalls`); opened by the person, it does.
    assert.equal(first.querySelector(".tool-children")?.children.length, 0, "closed, no rows of its calls");
    row.querySelector("summary").dispatch("click");
    row.open = true;
    row.dispatch("toggle");
    const r1 = first.querySelector(".tool-children")?.children[0];
    assert.ok(row && open && r1, "the card, its Open conversation, its first call's row");
    // Its next call, running: a row of its own beside the first.
    evs.push({ type: "subagent-tool-start", round: 1, parent: "a1", id: "c2", name: "bash", args: "npm test", card: { kind: "shell", title: "Run", subject: "npm test" } });
    const [again] = rows(evs, { drawn, live: true });
    assert.equal(again, first, "the card that stood");
    assert.equal(again.querySelector("details"), row, "its row");
    assert.equal(again.querySelector(".subagent-open"), open, "its Open conversation");
    const list = again.querySelector(".tool-children");
    assert.deepEqual([list.children.length, list.children[0]], [2, r1], "its first call's row stands, the new one after it");
    assert.match(String(row.querySelector("summary").textContent), /Run npm test/, "its line says the call it makes now");
    open.dispatch("click");
    assert.deepEqual(opened, ["sub-1"]);
    // Opened by the person, it is drawn again open: never folded for a moment on the way.
    /** @type {boolean[]} */
    const seen = [];
    const set = row.removeAttribute.bind(row);
    row.removeAttribute = (/** @type {string} */ k) => (k === "open" && seen.push(false), set(k));
    evs.push({ type: "subagent-tool-end", round: 1, parent: "a1", id: "c2", name: "bash", ok: true, ms: 3, chars: 2, preview: "ok" });
    rows(evs, { drawn, live: true });
    assert.deepEqual([row.open, seen], [true, []]);
  });
});

// (fails before: yes — the card of an agent the main agent asked was made anew at every drawing of the turn and its
// buttons at every word of the agents' list: Open and Stop new elements under a resting pointer)
test("the card of an agent the main agent asked is the card that stood at each drawing and each word of the list, its Open and Stop with it", async () => {
  /** @type {Set<() => void>} */
  const hearing = new Set();
  /** @type {string[]} */
  const pressed = [];
  const listed = { id: "sa_1", status: "running", model: "zai/glm-5.3", card: { tag: "pm", name: "PM" }, asked: true, may: "read", origin: "agent", description: "Queue or fail?", exchanges: [{ status: "running", startedAt: 1_000, description: "Queue or fail?" }], progress: null };
  await withActions({
    subagentRow: () => /** @type {any} */ (listed),
    subagentsKnown: () => true,
    openSubagent: (id) => void pressed.push(`open ${id}`),
    stopSubagent: (id) => void pressed.push(`stop ${id}`),
    watchSubagents: (fn) => (hearing.add(fn), () => void hearing.delete(fn)),
  }, async () => {
    const drawn = new Map();
    /** @type {any[]} */
    const evs = [
      { type: "round-start", round: 1 },
      { type: "tool-start", round: 1, id: "a1", name: "agent", args: "Queue or fail?", card: { kind: "subagent", title: "agent", subject: "Queue or fail?" } },
      { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", exchange: 0, description: "Queue or fail?", agent: "pm", model: "zai/glm-5.3", prompt: "Queue or fail?", card: { tag: "pm", name: "PM" }, asked: true },
    ];
    const [card] = rows(evs, { drawn, live: true });
    doc.document.body.append(card);
    await new Promise((r) => setImmediate(r));
    const buttons = () => /** @type {any[]} */ ([...card.querySelectorAll("button")]);
    const before = buttons();
    assert.deepEqual(before.map((b) => b.textContent), ["Open", "Stop"]);
    evs.push({ type: "subagent-tool-start", round: 1, parent: "a1", id: "r1", name: "read", args: "subagents.js", card: { kind: "read", title: "Read", subject: "subagents.js" } });
    const [again] = rows(evs, { drawn, live: true });
    assert.equal(again, card, "the card that stood");
    assert.match(String(card.textContent), /Read subagents\.js/, "painted from what its call says now");
    assert.deepEqual(buttons(), before, "its buttons the ones that stood");
    // The agents' list speaks: the card paints again, its buttons in place.
    for (const fn of [...hearing]) fn();
    assert.deepEqual(buttons(), before);
    assert.equal(hearing.size, 1, "one card hears the list: the drawings into it let go");
    before[1].dispatch("click");
    assert.deepEqual(pressed, ["stop sa_1"]);
  });
});

// (fails before: yes — an edit card drawn again was made anew, its diff and its counts a moment later: read again into
// an empty card, at every drawing of the turn and at its end)
test("an edit card drawn again keeps the diff and the counts that landed in it", () => {
  const drawn = new Map();
  /** @type {any[]} */
  const evs = [
    { type: "round-start", round: 1 },
    { type: "tool-start", round: 1, id: "e1", name: "edit", args: "src/a.js", card: { kind: "edit", title: "Edit", subject: "src/a.js" } },
    { type: "tool-end", round: 1, id: "e1", name: "edit", ok: true, ms: 4, chars: 10, preview: "edited" },
  ];
  const [first] = rows(evs, { drawn, runId: "run-1", live: true });
  const slot = first.querySelector(".inline-diff-slot");
  const counts = first.querySelector(".edit-counts");
  assert.ok(slot && counts);
  // What the reads brought: the diff in its slot, the lines in its counts.
  const diff = doc.document.createElement("div");
  diff.className = "inline-diff";
  slot.append(diff);
  counts.append(doc.document.createTextNode(" +3"));
  // The turn settles: every row is drawn again.
  const [again] = rows(evs, { drawn, runId: "run-1", live: false });
  assert.equal(again, first, "the card that stood");
  assert.equal(again.querySelector(".inline-diff-slot"), slot);
  assert.deepEqual([slot.children[0], String(counts.textContent)], [diff, " +3"], "what landed in it stays");
});
