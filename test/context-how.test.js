// HarnessV4_Tasks U3-3: the section "How earlier turns are kept" — the sheet's, opened from the ring's popover and the
// Context pane's row, and Settings' — on the fake DOM, by who holds the conversation (UX-2). Laid out as the mock of
// 10-18 (proposal_ux §4.12 step 4, U5 phase 3), in parts and plain words: When the chat is full — Your line (the ring's
// chip), Then (Ask me / Just do it), Back after a break (Ask me / Send as it is) —; How it makes room — the way in the
// card's words, who writes the summary —; History; and under Advanced what every request carries: for
// Filament's loop (UX-3) the tool results and the finer knobs; for a coding agent (UX-9) a fresh start, Filament's copy
// and Filament's methods on it; a client (UX-10) compacts by itself, its own model writing the summary. Each row's list is
// the instrument's own, and every write goes through the one writer. Then the agent's line, the line typed in words, the
// section drawn again only when what it shows moved, and the page's wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { howSection, pointLine } from "../src/ui/harness/panes/context-how.js";
import { lineFromWords, LINE_STOPS } from "../src/ui/harness/widgets/context.js";
import { howLevels, HOW_TITLE } from "../src/ui/harness/how-sheet.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";

/** The compactor's plan as the preview carries it: a 200K window, 120K now, the same model's cache warm; a fold leaves
 *  18K of the earlier turns, under the instant line. */
const PLAN = Object.freeze({
  native: true, now: 120_000, window: 200_000, line: 170_000, mode: "auto", method: "summary", writer: null, keepWhole: 1, instantTokens: 20_000, recommended: "session",
  methods: {
    fold: { after: 96_000, exact: true, turns: 11, earlier: 18_000, calls: 0, cost: 0, possible: true, instant: true },
    summary: { after: 9_000, exact: false, slices: 1, reads: "fork", model: "claude-opus-5-5", fork: true, cost: 0.29, possible: true },
  },
  writers: {
    session: { after: 9_000, exact: false, reads: "fork", model: "claude-opus-5-5", fork: true, cost: 0.29, possible: true, window: 200_000 },
    side: { after: 9_000, exact: false, reads: "whole", model: "house-cheap", cost: 0.23, possible: true, window: 128_000, windowSource: "assumed" },
    chosen: { model: "claude-opus-5-5", fork: true, why: "the session's model", cost: 0.29 },
    cache: { state: "warm", leftMs: 192_000, tokens: 110_000, model: "claude-opus-5-5", forkRoom: 20_000 },
  },
});
/** What a fresh agent session's start would weigh under each form (the preview's sweep). */
const SWEEP = Object.freeze({ plain: { tokens: 182_000 }, words: { tokens: 20_000 }, "fold+2": { tokens: 160_000 }, "fold+1": { tokens: 120_000 }, fold: { tokens: 71_000 } });

let keys = 0;
/**
 * The widgets' context over a session the test drives, recording every write and action. `native: false` with a client
 * window is a client's session; `agent` a coding agent's, `facts` its newest turn's.
 * @param {{ flat?: Record<string, any>, effective?: Record<string, any>, preview?: any, native?: boolean, sources?: Record<string, string>, windows?: any[],
 *   agent?: boolean, facts?: any, agentName?: string, key?: string }} [o]
 */
function world({ flat = {}, effective = {}, preview, native = true, sources = {}, windows = [], agent = false, facts = null, agentName = "", key } = {}) {
  const state = { flat: { "context.compaction.thresholdPercent": 85, ...flat }, preview: preview ?? { compaction: PLAN, compactions: [], forms: SWEEP, current: {} }, hash: "h1", turns: [{ n: 1 }] };
  /** @type {string[]} */
  const did = [];
  /** @type {any} */
  const ctx = {
    view: () => ({
      settings: { hash: state.hash, native, sources, window: { tokens: 200_000, source: "operator" }, flat: state.flat, effective: { context: { ...effective } } },
      facts, windows,
    }),
    hasSession: () => true,
    live: () => ({ rec: null, usage: null, facts, liveOut: 0, estimate: 0, streaming: false, agent }),
    turns: () => state.turns,
    write: (/** @type {any} */ c) => did.push(`write ${JSON.stringify(c)}`),
    accounts: { session: () => (agentName ? { agentName } : null) },
    undoCompaction: (/** @type {any} */ id) => did.push(`undo:${id}`),
    preview: async () => state.preview,
    models: () => [{ id: "house-cheap", upstream: "u" }],
    scrollToTurn: () => true,
    toast: () => {},
    openPane: (/** @type {string} */ p) => did.push(`pane ${p}`),
  };
  const modelSelect = () => ({ el: fakeH("button", { class: "model-chip" }, "chip"), setModels() {}, set() {}, setNote() {}, setLocked() {} });
  const make = () => howSection(ctx, { h: fakeH, drawIn: fakeDrawIn, key: key || `s${++keys}`, modelSelect });
  return { s: make(), make, did, state, ctx };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
/** The first node under `el` whose class list holds `cls`. @param {any} el @param {string} cls @returns {any} */
const find = (el, cls) => {
  if (!el || typeof el !== "object") return null;
  if (String(el.attrs?.class || "").split(/\s+/).includes(cls)) return el;
  for (const k of el.kids || []) {
    const r = find(k, cls);
    if (r) return r;
  }
  return null;
};
/** The first node under `el` that its aria-label names. @param {any} el @param {string} label @returns {any} */
const byLabel = (el, label) => {
  if (!el || typeof el !== "object") return null;
  if (el.attrs?.["aria-label"] === label) return el;
  for (const k of el.kids || []) {
    const r = byLabel(k, label);
    if (r) return r;
  }
  return null;
};
/** A row of the section by its id. @param {any} el @param {string} id @returns {any} */
const rowOf = (el, id) => {
  if (!el || typeof el !== "object") return null;
  if (el.attrs?.["data-row"] === id) return el;
  for (const k of el.kids || []) {
    const r = rowOf(k, id);
    if (r) return r;
  }
  return null;
};
/** A part of the section by its id (`data-part`: full, room, history). @param {any} el @param {string} id @returns {any} */
const partOf = (el, id) => {
  if (!el || typeof el !== "object") return null;
  if (el.attrs?.["data-part"] === id) return el;
  for (const k of el.kids || []) {
    const r = partOf(k, id);
    if (r) return r;
  }
  return null;
};
/** The button whose words start so. @param {any} el @param {string} starts */
const button = (el, starts) => buttonsOf(el).find((b) => textOf(b).startsWith(starts));
/** A row's ▾: the button that opens its list. @param {any} el @param {string} id */
const pick = (el, id) => find(rowOf(el, id), "inst-how-pick");
/** A list's radio whose words start so — not the row's ▾, which may say the same. @param {any} el @param {string} starts */
const radio = (el, starts) => buttonsOf(el).find((b) => b.attrs?.role === "radio" && textOf(b).startsWith(starts));
/** Advanced, opened: what every request carries is drawn. @template {{ s: any }} T @param {T} w @returns {T} */
const advanced = (w) => {
  if (button(w.s.el, "Advanced")?.attrs?.["aria-expanded"] !== "true") button(w.s.el, "Advanced").dispatch("click");
  return w;
};
/** The choice a row's two-way switch is on. @param {any} r */
const onOf = (r) => buttonsOf(find(r, "inst-seg")).filter((b) => b.classList.contains("is-on")).map((b) => textOf(b));

// (fails before: yes — the section did not exist; then, U11, every row stood on its face at once, and the owner wrote
// "Newest turn, oldest turn, digest, trim to 30% by default all of this is super confusing"; then, U5 phase 3, the
// mock's parts: the compactions came back to the face, in plain words)
test("Filament's loop, in the mock's parts: When the chat is full — your line, then, back after a break —, How it makes room — the way, who writes the summary —, History, and what every request carries under Advanced", async () => {
  const w = world();
  await settle();
  const text = textOf(w.s.el);
  for (const bit of [
    "How earlier turns reach the model",
    "When the chat is full", "Your line|where room is made|170K · 85%",
    "Then|a message past the line|Ask me|Just do it",
    "Back after a break|the cache has gone cold|Ask me|Send as it is",
    "How it makes room", "The way|the card's first choice|≈9K after|One summary",
    "Summaries written by|when Filament writes one|≈$0.29 each time|The same model",
    "History|None yet. A compaction lands here, and as a row in the chat where it happened.",
    "Advanced|what every request carries",
  ]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  for (const gone of ["Earlier turns", "Folded", "Digests", "Tool results", "↳"]) assert.ok(!text.includes(gone), `no ${gone} on its face: ${text}`);
  // (fails before: yes — the closed line promised "newest whole · target" to a Whole view with One summary, which has
  // neither; then, the owner's rules of 10-31, the instant line is a setting of its own beside either method)
  assert.equal(button(w.s.el, "Advanced").attrs.title, "Holds the instant line · tool results", "Advanced names only what it holds");
  assert.ok(!text.includes("keeps its own") && !text.includes("decides"), "no agent's words in the loop's section");
  advanced(w);
  const adv = textOf(find(w.s.el, "inst-how-advanced"));
  for (const bit of ["Every turn", "Tool results", "As is"]) assert.ok(adv.includes(bit), `${bit} in ${adv}`);
  // (fails before: yes — the owner's rules of 10-31: every request sends its turns whole until a compaction, so no row
  // chooses how earlier turns are sent, and nothing offers a fold)
  for (const gone of ["Earlier turns", "Try it", "would send"]) assert.ok(!adv.includes(gone), `no ${gone} under Advanced: ${adv}`);
});

// (fails before: yes — U5 phase 3: the line was a link to the ring's bar; the mock gives it a chip with its stops, and a
// number of your own)
test("Your line: the ring's chip — its tokens and share of the window — and a number typed in its field, a percent or tokens; nothing carried with it", async () => {
  const w = world();
  await settle();
  const row = rowOf(w.s.el, "line");
  assert.equal(textOf(find(row, "inst-line-chip")), "170K · 85%");
  const field = find(row, "inst-line-field");
  field.value = "lots";
  field.dispatch("keydown", { key: "Enter" });
  assert.equal(w.did.length, 0, "words that name no line write nothing");
  field.value = "100k";
  field.dispatch("keydown", { key: "Enter" });
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"thresholdPercent":50}}}}', "tokens, as a share of the window");
  field.value = "35%";
  field.dispatch("keydown", { key: "Enter" });
  // (fails before: yes — the owner's rules of 10-31: a line set low carried a target under it, which no compaction aims for now)
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"thresholdPercent":35}}}}', "the line alone");
  assert.deepEqual(LINE_STOPS, [50, 70, 85, 95]);
  assert.deepEqual([lineFromWords("40", 200_000), lineFromWords("40%", 0), lineFromWords("400k", 1_000_000), lineFromWords("1m", 2_000_000), lineFromWords("120,000", 200_000)], [40, 40, 40, 50, 60]);
  assert.deepEqual([lineFromWords("400k", 0), lineFromWords("", 200_000), lineFromWords("half", 200_000), lineFromWords("0", 200_000)], [null, null, null, null], "tokens with no window, and words that name no line");
  assert.equal(lineFromWords("3%", 200_000), 15, "on the line's band");
  assert.equal(lineFromWords("99%", 200_000), 95);
});

test("a row's ▾ opens the instrument's own list under it, one at a time; a pick writes and the list stays open; what is open outlives the pane drawing again", async () => {
  const w = advanced(world({ key: "kept" }));
  await settle();
  pick(w.s.el, "writer").dispatch("click");
  assert.equal(pick(w.s.el, "writer").attrs["aria-expanded"], "true");
  assert.ok(textOf(rowOf(w.s.el, "writer")).includes("Side model"), textOf(rowOf(w.s.el, "writer")));
  // The method's ▾: the writer's list closes, the methods weighed open.
  pick(w.s.el, "method").dispatch("click");
  assert.ok(!textOf(rowOf(w.s.el, "writer")).includes("Side model"), "one list at a time");
  const method = rowOf(w.s.el, "method");
  for (const bit of ["One summary", "≈ $0.29 · 1 call · from the cache", "≈9K", "Instant fold", "Free · no model call · leaves 18K of the earlier turns", "96K"]) assert.ok(textOf(method).includes(bit), `${bit} in ${textOf(method)}`);
  for (const gone of ["✓", "✗", "Make room down to"]) assert.ok(!textOf(method).includes(gone), `no ${gone}: ${textOf(method)}`);
  radio(method, "Instant fold").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"method":"fold"}}}}');
  assert.ok(radio(rowOf(w.s.el, "method"), "Instant fold"), "the list stays open after a pick");
  // The pane draws again (a turn's end, a tab switch): the same session's section opens as it was left, Advanced too.
  const again = w.make();
  await settle();
  assert.equal(pick(again.el, "method").attrs["aria-expanded"], "true");
  pick(again.el, "method").dispatch("click");
  assert.equal(pick(again.el, "method").attrs["aria-expanded"], "false", "its ▾ closes it");
});

test("Summaries written by: while the method writes a summary — the writer and what it costs, its list without a second title; a fold writes none", async () => {
  const w = world();
  await settle();
  pick(w.s.el, "writer").dispatch("click");
  const writer = rowOf(w.s.el, "writer");
  for (const bit of ["Same model", "Side model", "claude-opus-5-5", "house-cheap", "Same model · warm cache, 3:12 left", "Side model · 128K assumed · Reads the turns whole"]) assert.ok(textOf(writer).includes(bit), `${bit} in ${textOf(writer)}`);
  assert.ok(!textOf(writer).includes("Cheaper"), "the same model or a side model: no cheaper-at-the-moment writer");
  assert.equal(textOf(w.s.el).split(/written by/i).length - 1, 1, "the row names it once");
  button(writer, "Side model").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"writer":"model"}}}}');
  const named = world({ flat: { "context.compaction.writer": "model", "context.compaction.model": "agent/house-cheap" } });
  await settle();
  assert.ok(textOf(rowOf(named.s.el, "writer")).includes("house-cheap"), "a named writer by its name");
  const fold = world({ flat: { "context.compaction.method": "fold" } });
  await settle();
  assert.equal(rowOf(fold.s.el, "writer"), null, "a fold calls no model: no writer row");
  advanced(fold);
  assert.ok(textOf(fold.s.el).includes("Keep whole|The newest finished turns, as they are"), "a fold's own number instead");
});

// (fails before: yes — the writer's list said three things that are not so: pressing the writer it showed wrote it as
// the chat's choice, so a cold card stopped recommending the side model; a writer whose reading is the instant fold
// cost "≈ $0.00"; and with no chat to weigh, Settings' list drew its placeholders for good)
test("Summaries written by, opened: pressing the writer shown chooses nothing, a reading that is the instant fold is free, and your defaults draw no placeholders", async () => {
  const w = world();
  await settle();
  pick(w.s.el, "writer").dispatch("click");
  const before = w.did.length;
  button(rowOf(w.s.el, "writer"), "Same model").dispatch("click");
  assert.deepEqual(w.did.slice(before), [], "none chosen, the rule shows Same model: pressing it writes nothing");

  const instant = { ...PLAN, writers: { ...PLAN.writers, side: { ...PLAN.writers.side, reads: "instant", cost: 0, listCost: 0, slices: 0, calls: 0 } } };
  const free = world({ preview: { compaction: instant, compactions: [], forms: SWEEP, current: {} } });
  await settle();
  pick(free.s.el, "writer").dispatch("click");
  const writers = textOf(rowOf(free.s.el, "writer"));
  assert.ok(writers.includes("Free · no model call") && !writers.includes("$0.00"), writers);

  const x = world({ flat: { "context.compaction.method": "summary" }, preview: {}, key: "defaults-writer" });
  const s = howSection(x.ctx, { h: fakeH, drawIn: fakeDrawIn, key: "defaults-writer", modelSelect: () => ({ el: fakeH("button", {}, "chip"), setModels() {}, set() {}, setNote() {}, setLocked() {} }), defaults: () => ({ preset: null }) });
  await settle();
  pick(s.el, "writer").dispatch("click");
  assert.ok(rowOf(s.el, "writer"), "the row is there");
  assert.equal(find(rowOf(s.el, "writer"), "inst-skel"), null, "no chat to weigh, nothing on its way: no placeholder");
});

test("History: the compactions so far, each with what it left, Undo on the newest", async () => {
  const compactions = [
    { id: 6, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary", at: Date.now() - 3_600_000 },
    { id: 7, fromTurn: 1, toTurn: 6, kind: "manual", method: "fold", at: Date.now() - 120_000, detail: { before: 150_000, after: 96_000, exact: true, how: "local" }, undoable: true },
  ];
  const w = world({ preview: { compaction: PLAN, compactions, forms: SWEEP, current: {} } });
  await settle();
  const text = textOf(w.s.el);
  for (const bit of ["History|2 so far · the last 2 min ago", "Undo"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  const hist = partOf(w.s.el, "history");
  for (const bit of ["Turns 1–6 folded", "150k → 96k", "Turns 1–3 summarized"]) assert.ok(textOf(hist).includes(bit), `${bit} in ${textOf(hist)}`);
  assert.equal(buttonsOf(hist).filter((b) => textOf(b) === "Undo").length, 1, "Undo on the newest alone");
  button(hist, "Undo").dispatch("click");
  assert.equal(w.did.at(-1), "undo:7", "Undo takes the newest back");
});

// (fails before: yes — the owner's rules of 10-31: the instant line had no control, and a target stood beside Least lossy;
// and of 11-07: Tool results offered four policies, and One line wrote the line without its recall id)
test("Advanced: the numbers behind the names — the method's own, the instant line beside either — and the tool results", async () => {
  const w = world({ flat: { "context.results": "status" } });
  await settle();
  assert.equal(button(w.s.el, "Advanced").attrs.title, "Holds the instant line · tool results");
  button(w.s.el, "Advanced").dispatch("click");
  const adv = find(w.s.el, "inst-how-advanced");
  const text = textOf(adv);
  for (const bit of ["Every turn", "Tool results", "As is", "One line", "One line without its recall id, chosen before · ",
    "Making room", "Instant fold up to", "A fold now leaves 18K of them"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  for (const gone of ["Budget walk", "Digests", "Custom", "Earlier turns", "Least lossy", "Keep word for word", "Keep whole", "Newest only", "Pointers"]) assert.ok(!text.includes(gone), `no ${gone}: ${text}`);
  const seg = find(adv, "inst-seg");
  assert.deepEqual(buttonsOf(seg).map(textOf), ["As is", "One line"], "two offered");
  assert.deepEqual(buttonsOf(seg).map((b) => b.attrs["aria-checked"]), ["false", "false"], "the policy chosen before is neither");
  // (fails before: yes — the review of d55677d7f: with neither lit, both left the tab order, and Tab skipped the row)
  assert.deepEqual(buttonsOf(seg).map((b) => b.attrs.tabindex), ["0", "-1"], "the first is still reached by Tab");
  button(adv, "One line").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"results":"line"}}}');
  const line = byLabel(adv, "The most an instant fold may leave of the earlier turns");
  buttonsOf(line).find((b) => textOf(b) === "10K").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"instantTokens":10000}}}}');
  assert.ok(button(w.s.el, "Advanced").attrs["aria-expanded"] === "true", "Advanced stays open while it is drawn again");
  // A fold keeps its newest turns whole; a chosen tool-result policy offers Filament's default back.
  const other = world({ flat: { "context.compaction.method": "fold", "context.results": "pointer" }, sources: { "context.results": "session" } });
  await settle();
  assert.equal(button(other.s.el, "Advanced").attrs.title, "Holds newest whole · the instant line · tool results", "a fold");
  button(other.s.el, "Advanced").dispatch("click");
  const adv2 = find(other.s.el, "inst-how-advanced");
  const t2 = textOf(adv2);
  for (const bit of ["Keep whole", "Instant fold up to", "Pointers, chosen before · |Chosen for this session · |The default"]) assert.ok(t2.includes(bit), `${bit} in ${t2}`);
  button(adv2, "The default").dispatch("click");
  assert.equal(other.did.at(-1), 'write {"unset":["context.results"]}');
});

/** Claude Code's newest turn: what it holds of its 1M window, and the point it took (A3). @param {any} [point] */
const claudeFacts = (point = { at: 400_000, line: 400_000 }) => ({ context: { held: 330_000, window: 1_000_000, source: "agent", ...(point ? { point } : {}) } });
/** The plan's word on Claude Code's session: it has its own compaction and can write the summary, warm. */
const agentPlan = (o = {}) => ({ compaction: { ...PLAN, agent: { weighed: true, held: 330_000, own: "live", self: "fork", suggested: true, way: "self", chosen: "suggested", warmUntil: Date.now() + 200_000, ...o } }, compactions: [], forms: SWEEP, current: {} });

test("a coding agent (UX-9): your line with where it compacts by itself, then and back after a break; its way; History; under Advanced a fresh start, Filament's copy and Filament's methods on it", async () => {
  const w = world({ agent: true, agentName: "Claude Code", facts: claudeFacts(), flat: { "context.compaction.thresholdPercent": 40 }, preview: agentPlan() });
  await settle();
  const text = textOf(w.s.el);
  for (const bit of ["How earlier turns reach Claude Code", "Your line|where room is made|400K · 40%", "↳ Claude Code compacts at your line, even mid-turn.",
    "Then|a message past the line|Ask me", "Back after a break", "How it makes room", "The way|the card's first choice|Suggested · Claude Code writes a summary now", "History",
    "Advanced|what every request carries"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  for (const gone of ["sends", "would send", "written by", "Makes room by", "keeps its own context"]) assert.ok(!text.includes(gone), `no ${gone} on an agent's face: ${text}`);
  assert.equal(find(rowOf(w.s.el, "asks-cold"), "inst-how-label").attrs.title, "A coding agent's cache lasts an hour at the most. A message sent after that reads the whole chat again at the full price, so a card asks first.");
  assert.equal(button(w.s.el, "Advanced").attrs.title, "Holds a fresh start · Filament's copy · Filament's methods on it");
  advanced(w);
  const adv = textOf(find(w.s.el, "inst-how-advanced"));
  for (const bit of ["A fresh start", "Filament's copy", "Compact on Filament's copy instead"]) assert.ok(adv.includes(bit), `${bit} in ${adv}`);
  assert.ok(!adv.includes("Earlier turns"), "no row for how each request is sent");
  assert.ok(!adv.includes("Tool results"), "the loop's finer knobs are not an agent's");
  pick(w.s.el, "way").dispatch("click");
  const way = rowOf(w.s.el, "way");
  for (const bit of ["Claude Code's own compaction", "Claude Code writes a summary", "Filament's copy", "Now"]) assert.ok(textOf(way).includes(bit), `${bit} in ${textOf(way)}`);
  button(way, "Claude Code's own compaction").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"agent":"own"}}}}');
  // Filament's copy: its methods, said as what a fresh session starts from.
  const copy = find(w.s.el, "inst-how-advanced");
  for (const bit of ["Filament keeps its own copy of this chat. A fresh Claude Code session starts from it", "One summary", "Instant fold", "Instant fold up to", "Written by"]) assert.ok(textOf(copy).includes(bit), `${bit} in ${textOf(copy)}`);
  // (fails before: yes — HarnessV4_Tasks C30 item 4: "These shape that copy", while keeping it in step always wrote one
  // summary) When these apply, and what the background writes.
  assert.ok(textOf(copy).includes("These are how the copy makes room when you compact on it; kept in step in the background, it gets one summary of all but its newest turn."), textOf(copy));
  radio(copy, "Instant fold").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"method":"fold"}}}}');
  // Its own way chosen: with no line taken yet, it compacts at its own point.
  const own = world({ agent: true, agentName: "Claude Code", facts: claudeFacts(null), flat: { "context.compaction.agent": "own", "context.compaction.mode": "auto" }, preview: agentPlan({ way: "own", chosen: "own", suggested: false }) });
  await settle();
  const face = textOf(own.s.el);
  assert.ok(face.includes("↳ Your line acts between turns; Claude Code compacts by itself at its own point."), face);
  assert.equal(button(rowOf(own.s.el, "asks-fit"), "Just do it").attrs.title, "Room is made by itself (Claude Code's own compaction), then your message goes. Nothing asks.");
  assert.ok(face.includes("Claude Code's own compaction"), face);
});

// (fails before: yes — an agent's section had no row for a fresh start, and `context.carry` did not exist: the start
// followed the view, which an agent's session does not show)
test("a coding agent's fresh start (U3-7, UX-12): the row says what it carries of earlier turns, its ▾ opens the shared control with each form's size, a pick writes context.carry", async () => {
  const w = advanced(world({ agent: true, agentName: "Claude Code", facts: claudeFacts(), preview: agentPlan() }));
  await settle();
  const row = () => rowOf(w.s.el, "carry");
  // (fails before: yes — HarnessV4_Tasks C28: unless chosen the start was Whole)
  assert.ok(textOf(row()).startsWith("A fresh start|carries earlier turns as|starts from ≈20K|Words"), textOf(row()));
  assert.match(String(pick(w.s.el, "carry").attrs.title), /a switch into Claude Code/, "the hint says when a fresh session starts");
  pick(w.s.el, "carry").dispatch("click");
  const open = find(row(), "carry");
  assert.equal(find(open, "carry-label"), null, "the row already says the label: the control under it does not say it twice");
  assert.equal(find(open, "carry-segs").attrs["aria-label"], "Carry earlier turns as", "it stays the group's name");
  assert.ok(!textOf(row()).includes("weighs the same"), "the forms differ here: nothing more to say");
  assert.deepEqual(buttonsOf(open).map((b) => textOf(b)), ["Words|20K", "Folded|71K", "Folded, newest 2 whole|160K", "Whole|182K"]);
  assert.deepEqual(buttonsOf(open).map((b) => b.attrs["aria-checked"]), ["true", "false", "false", "false"]);
  assert.equal(textOf(find(open, "carry-line")), "Your words and the agent's, each turn's tool calls counted in one line.");
  buttonsOf(open)[1].dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"carry":"fold"}}}');
  // The form the session chose, and what a start under it weighs.
  const f = advanced(world({ agent: true, agentName: "Claude Code", facts: claudeFacts(), effective: { carry: "fold" }, preview: agentPlan() }));
  await settle();
  assert.ok(textOf(rowOf(f.s.el, "carry")).startsWith("A fresh start|carries earlier turns as|starts from ≈71K|Folded"), textOf(rowOf(f.s.el, "carry")));
  // What a start would carry holds no tool calls: every form weighs the same, and the row says why.
  const flat = advanced(world({ agent: true, agentName: "Claude Code", facts: claudeFacts(), preview: { ...agentPlan(), forms: { words: { tokens: 113 }, plain: { tokens: 113 }, fold: { tokens: 113 }, "fold+2": { tokens: 113 } } } }));
  await settle();
  // (fails before: yes — V4-D217: the line ran to two lines in a 540-pixel pane)
  assert.ok(textOf(rowOf(flat.s.el, "carry")).includes("↳ Every form weighs the same now: no tool calls to fold."), textOf(rowOf(flat.s.el, "carry")));
  // Filament's loop sends its own turns: no such row.
  const loop = advanced(world());
  await settle();
  assert.equal(rowOf(loop.s.el, "carry"), null);
});

// (fails before: yes — HarnessV4_Tasks C29: nothing said what Filament does with its own copy as the agent compacts,
// and nothing switched it)
test("Filament's copy in a coding agent's chat (C29): the row says it is kept in step and who writes its summary; its switch writes context.compaction.follow; switched off, and with no model, it says what the copy does", async () => {
  const cheap = { session: null, side: { model: "house-cheap", cost: 0.02 }, chosen: { model: "house-cheap", fork: false, why: "memory's model (the session's is a coding agent)", cost: 0.02 } };
  const plan = (/** @type {any} */ writers) => ({ ...agentPlan(), compaction: { ...agentPlan().compaction, writers } });
  const w = advanced(world({ agent: true, agentName: "Codex", facts: claudeFacts(null), preview: plan(cheap) }));
  await settle();
  const row = () => rowOf(w.s.el, "copy");
  assert.ok(textOf(row()).startsWith("Filament's copy|Kept in step"), textOf(row()));
  // (fails before: yes — V4-D217: the whole sentence stood under the row, three lines in a 540-pixel pane) One line under
  // it, the whole sentence its title.
  assert.ok(textOf(row()).includes("↳ house-cheap writes its summary in the background."), textOf(row()));
  assert.equal(find(row(), "inst-how-why").attrs.title, "When Codex compacts and hands no summary over, or the copy passes the line, house-cheap writes the copy's summary in the background, once that makes the copy smaller. Its own session goes on as it is.");
  pick(w.s.el, "copy").dispatch("click");
  const sw = find(row(), "ios-switch");
  assert.deepEqual([sw.attrs["aria-label"], sw.checked], ["Keep the copy in step", true]);
  sw.dispatch("change", { target: { checked: true } });
  assert.equal(w.did.length, 0, "the value it has: nothing written");
  sw.dispatch("change", { target: { checked: false } });
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"follow":false}}}}');
  // Switched off: the copy keeps every turn, and a start that does not fit asks.
  const off = advanced(world({ agent: true, agentName: "Codex", facts: claudeFacts(null), flat: { "context.compaction.follow": false }, preview: plan(cheap) }));
  await settle();
  assert.ok(textOf(rowOf(off.s.el, "copy")).startsWith("Filament's copy|Keeps every turn"), textOf(rowOf(off.s.el, "copy")));
  assert.ok(textOf(rowOf(off.s.el, "copy")).includes("↳ The copy keeps every turn until you compact it; a start that does not fit asks first."));
  // No model to write with: said, with what to do.
  const none = advanced(world({ agent: true, agentName: "Codex", facts: claudeFacts(null), preview: plan({ session: null, side: null, chosen: null }) }));
  await settle();
  assert.ok(textOf(rowOf(none.s.el, "copy")).includes("↳ No model to write the copy's summary with: name a compaction model, or give memory one. Until then the copy keeps every turn."), textOf(rowOf(none.s.el, "copy")));
  // Filament's loop keeps no copy apart from what it sends: no such row.
  const loop = advanced(world());
  await settle();
  assert.equal(rowOf(loop.s.el, "copy"), null);
});

// (fails before: yes — the section knew no defaults: it drew a session's compactions, sent the line to a ring the
// settings page does not have, and said nothing of where a value came from)
test("Settings › How earlier turns are kept (U3-8): the same section over your defaults — the loop's rows and an agent's, the line's chip in percent, where each value comes from", async () => {
  const w = world({
    flat: { "context.compaction.thresholdPercent": 70, "context.compaction.method": "fold", "context.compaction.agent": "suggested", "context.results": "status" },
    effective: { carry: "plain" },
    sources: { "context.results": "global", "context.compaction.thresholdPercent": "session", "context.compaction.method": "session" },
    preview: {},
    key: "defaults-1",
  });
  const s = howSection(w.ctx, { h: fakeH, drawIn: fakeDrawIn, key: "defaults-1", modelSelect: () => ({ el: fakeH("button", {}, "chip"), setModels() {}, set() {}, setNote() {}, setLocked() {} }), defaults: true });
  await settle();
  const face = textOf(s.el);
  for (const bit of ["How earlier turns reach the model, where a chat has not chosen its own", "Your line|where room is made|70%|↳ Your default", "Then|a message past the line|Ask me", "Back after a break",
    "The way|in the chats Filament runs itself|Instant fold", "A coding agent's way|in a coding agent's chat|Suggested", "Advanced|what every request carries"]) assert.ok(face.includes(bit), `${bit} on the face: ${face}`);
  assert.equal(button(s.el, "Advanced").attrs.title, "Holds a coding agent's fresh start and copy · newest whole · the instant line · tool results");
  advanced({ s });
  const text = textOf(s.el);
  for (const bit of ["Tool results", "From the dashboard's rules", "In a coding agent's chat", "A fresh start", "carries earlier turns as", "Whole"])
    assert.ok(text.includes(bit), `${bit} in ${text}`);
  for (const gone of ["History", "None yet", "Budget walk", "Earlier turns"]) assert.ok(!text.includes(gone), `no ${gone} among defaults: ${text}`);
  assert.ok(!/sends \d/.test(text), `no chat to weigh what a turn sends: ${text}`);
  // The line is set here as on the ring, by its chip: a stop or a number of your own — a percent, as there is no window.
  const lineRow = rowOf(s.el, "line");
  assert.equal(textOf(find(lineRow, "inst-line-chip")), "70%");
  const field = find(lineRow, "inst-line-field");
  field.value = "400k";
  field.dispatch("keydown", { key: "Enter" });
  assert.equal(w.did.length, 0, "tokens need a window: nothing written");
  field.value = "80";
  field.dispatch("keydown", { key: "Enter" });
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"thresholdPercent":80}}}}');
  // Your default is taken back from its row: the knob of the row that is yours.
  button(rowOf(s.el, "line"), "Reset").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"unset":["context.compaction.thresholdPercent"]}');
  button(rowOf(s.el, "method"), "Reset").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"unset":["context.compaction.method"]}');
  // Each list writes the same knobs a session's does.
  pick(s.el, "way").dispatch("click");
  button(rowOf(s.el, "way"), "Filament's copy").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"agent":"ours"}}}}');
  // Filament's copy of an agent's chat (HarnessV4_Tasks C29): among an agent's rows, its switch your default.
  assert.ok(textOf(rowOf(s.el, "copy")).startsWith("Filament's copy|Kept in step"), textOf(rowOf(s.el, "copy")));
  assert.ok(textOf(rowOf(s.el, "copy")).includes("↳ A model Filament calls writes its summary in the background."), textOf(rowOf(s.el, "copy")));
  assert.equal(find(rowOf(s.el, "copy"), "inst-how-why").attrs.title, "When the agent compacts and hands no summary over, or the copy passes the line, a model Filament calls writes the copy's summary in the background, once that makes the copy smaller.");
  pick(s.el, "copy").dispatch("click");
  find(rowOf(s.el, "copy"), "ios-switch").dispatch("change", { target: { checked: false } });
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"follow":false}}}}');
  pick(s.el, "carry").dispatch("click");
  assert.equal(find(rowOf(s.el, "carry"), "carry-seg-fig"), null, "no chat to weigh: the forms of a fresh start carry no figures here");
  buttonsOf(rowOf(s.el, "carry")).find((b) => b.attrs["data-carry"] === "fold").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"carry":"fold"}}}');
  // The dashboard's mirror names the writer's model even when none is named: that is no rule to speak of.
  const writerOf = (/** @type {any} */ model) => {
    const x = world({ flat: { "context.compaction.method": "summary", "context.compaction.model": model }, sources: { "context.compaction.model": "global" }, preview: {}, key: `defaults-w-${model}` });
    return textOf(rowOf(howSection(x.ctx, { h: fakeH, drawIn: fakeDrawIn, key: `defaults-w-${model}`, modelSelect: () => ({ el: fakeH("button", {}, "chip"), setModels() {}, set() {}, setNote() {}, setLocked() {} }), defaults: true }).el, "writer"));
  };
  assert.ok(!writerOf(null).includes("dashboard"), writerOf(null));
  assert.ok(writerOf("house-cheap").includes("↳ From the dashboard's rules"), writerOf("house-cheap"));
  assert.ok(writerOf(null).includes("↳ In the chats Filament runs itself, as with GLM; a coding agent writes its own."), writerOf(null));
  assert.ok(!textOf(s.el).includes("preset"), "there are no presets (the owner's of 11-07): no row speaks of one");
});

/** OpenCode's chat: a client's session, which the server sends no compaction plan for. */
const opencode = (/** @type {any} */ o = {}) => world({ native: false, windows: [{ window: "opencode", clientLabel: "OpenCode" }], preview: { compactions: [], forms: SWEEP, current: {} }, ...o });

// (fails before: yes — the owner's rules of 10-31: an outside client gets a plain proxy plus memory, so Filament never
// answers its compaction: the row offered Filament's ways, a writer and Advanced, and choosing one lifted the session's off)
test("a client (UX-10): it compacts by itself, its own model writing the summary — one still row; no line of Filament's, no way to choose, no writer, no Advanced", async () => {
  const w = opencode();
  await settle();
  const text = textOf(w.s.el);
  assert.ok(text.includes("The way|OpenCode compacts by itself|OpenCode's own"), text);
  for (const gone of ["When the chat is full", "Your line", "Earlier turns", "Filament can answer", "One summary", "Instant fold", "Advanced"]) assert.ok(!text.includes(gone), `no ${gone} on a client's face: ${text}`);
  assert.equal(rowOf(w.s.el, "writer"), null, "Filament stays out: nothing of its own writes");
  assert.equal(pick(w.s.el, "method"), null, "nothing to choose");
  assert.equal(w.did.length, 0);
});

// What the Compaction pill's popover said on its How row: the rows hold it now, so the pill can go (HarnessV4_Tasks U3-4).
// (fails before: yes — the row named the method and nothing of what it would leave, or why it cannot run)
test("The way says what the method in force would leave now, and why it cannot run", async () => {
  const w = world();
  await settle();
  const row = (/** @type {any} */ x) => textOf(rowOf(advanced(x).s.el, "method"));
  assert.ok(row(w).includes("≈9K after"), row(w));
  assert.ok(!row(w).includes("↳"), `nothing under it: the line is a row of its own: ${row(w)}`);
  const exact = world({ flat: { "context.compaction.method": "fold" } });
  await settle();
  assert.ok(row(exact).includes("|96K after"), `a fold is counted, not estimated: ${row(exact)}`);
  const cannot = world({ preview: { compaction: { ...PLAN, methods: { ...PLAN.methods, summary: { possible: false, why: "no finished turn to summarize yet" } } }, compactions: [], forms: SWEEP, current: {} } });
  await settle();
  assert.ok(row(cannot).includes("↳ Can't run now: no finished turn to summarize yet"), row(cannot));
  assert.ok(!row(cannot).includes("after"), `no figure for what cannot run: ${row(cannot)}`);
});

test("where a coding agent compacts by itself, in one line: at the line, at 67K at the earliest under it, before it at 967K, a moved line at the next turn, its own point with no line handed", () => {
  const who = "Claude Code";
  assert.equal(pointLine({ who, line: 400_000, point: { at: 400_000, line: 400_000 } }), "Claude Code compacts at your line, even mid-turn.");
  assert.equal(pointLine({ who, line: 50_000, point: { at: 67_000, line: 50_000 } }), "Claude Code compacts by itself at 67K at the earliest, even mid-turn; Filament checks your line between turns.");
  assert.equal(pointLine({ who, line: 990_000, point: { at: 967_000, line: 990_000 } }), "Claude Code compacts by itself at 967K, before your line.");
  assert.equal(pointLine({ who, line: 400_000, point: { at: 300_000, line: 300_000 } }), "Claude Code takes your new line as a turn starts.");
  assert.equal(pointLine({ who: "The agent", line: 400_000, point: null }), "Your line acts between turns; the agent compacts by itself at its own point.");
  assert.equal(pointLine({ who, line: null, point: null }), "Claude Code compacts by itself at its own point.");
});

// (fails before: yes — HarnessV4_Tasks C26: the card's "Don't ask again" wrote a switch no control on the page wrote
// back, and Automatic / Ask first sat inside When it's full as if it were about a running turn; then, U11, each was a
// switch behind a ▾ named "When it does not fit · Asks first"; then, U5 phase 3, the mock's Then and Back after a break)
test("Then, and Back after a break: each one choice of two — Ask me, or what the card's way to stop being asked writes; what each does is its title", async () => {
  const w = world();
  await settle();
  const row = (/** @type {string} */ id) => rowOf(w.s.el, id);
  assert.ok(textOf(row("asks-fit")).startsWith("Then|a message past the line|Ask me|Just do it"), textOf(row("asks-fit")));
  assert.deepEqual(onOf(row("asks-fit")), ["Ask me"]);
  assert.equal(pick(w.s.el, "asks-fit"), null, "the choice is on the row: nothing to open");
  assert.equal(button(row("asks-fit"), "Ask me").attrs.title, "Your message waits, and a card asks before room is made. A turn already running makes room by itself.");
  button(row("asks-fit"), "Ask me").dispatch("click");
  assert.equal(w.did.length, 0, "the value it has: nothing written");
  button(row("asks-fit"), "Just do it").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"mode":"auto"}}}}');
  assert.ok(textOf(row("asks-cold")).startsWith("Back after a break|the cache has gone cold|Ask me|Send as it is"), textOf(row("asks-cold")));
  assert.equal(find(row("asks-cold"), "inst-how-label").attrs.title, "A model's cache lasts five minutes or an hour, by its route. A message sent after that reads the whole chat again at the full price, so a card asks first.");
  button(row("asks-cold"), "Send as it is").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"resumeQuestion":false}}}}');
  // Both switched off, as the cards' own buttons leave them: the rows say so, and one click brings each back.
  const off = world({ flat: { "context.compaction.mode": "auto", "context.compaction.resumeQuestion": false } });
  await settle();
  assert.deepEqual(onOf(rowOf(off.s.el, "asks-fit")), ["Just do it"]);
  assert.equal(button(rowOf(off.s.el, "asks-fit"), "Just do it").attrs.title, "Room is made by itself (One summary), then your message goes. Nothing asks.");
  assert.deepEqual(onOf(rowOf(off.s.el, "asks-cold")), ["Send as it is"]);
  assert.equal(find(rowOf(off.s.el, "asks-cold"), "inst-how-label").attrs.title, "A model's cache lasts five minutes or an hour, by its route. A message sent after that reads the whole chat again at the full price, and nothing asks.");
  button(rowOf(off.s.el, "asks-cold"), "Ask me").dispatch("click");
  assert.equal(off.did.at(-1), 'write {"patch":{"context":{"compaction":{"resumeQuestion":true}}}}');
});

// (fails before: yes — U5 phase 3: a chat's rows did not say which it had changed; the mock's "changed here · use yours")
test("a chat's own: a row it changed says Changed here, and Use yours takes its value back; a row that follows yours says nothing", async () => {
  const sources = { "context.compaction.thresholdPercent": "session", "context.compaction.mode": "session", "context.compaction.method": "global" };
  const w = world({ flat: { "context.compaction.thresholdPercent": 60, "context.compaction.mode": "auto" }, sources });
  await settle();
  const line = rowOf(w.s.el, "line");
  assert.ok(textOf(line).endsWith("↳ Changed here · |Use yours"), textOf(line));
  assert.equal(button(line, "Use yours").attrs.title, "Take this chat's own value back: the row follows your defaults again");
  button(line, "Use yours").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"unset":["context.compaction.thresholdPercent"]}');
  button(rowOf(w.s.el, "asks-fit"), "Use yours").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"unset":["context.compaction.mode"]}');
  for (const id of ["asks-cold", "method", "writer"]) assert.ok(!textOf(rowOf(w.s.el, id)).includes("Changed here"), `${id} follows yours`);
  // A coding agent's chat says it too, under its own lines.
  const agentW = world({ agent: true, agentName: "Claude Code", facts: claudeFacts(), flat: { "context.compaction.agent": "ours" }, sources: { "context.compaction.agent": "session" }, preview: agentPlan() });
  await settle();
  assert.ok(textOf(rowOf(agentW.s.el, "way")).endsWith("↳ Changed here · |Use yours"), textOf(rowOf(agentW.s.el, "way")));
});

// (fails before: yes — U5 phase 3: the section had no levels; the sheet offers this chat, its project and every new chat)
// (the owner's of 11-07: there are no presets, so a project holds none of these and is no level)
test("the sheet's levels: This chat where there is a session, and All new chats always", () => {
  assert.equal(HOW_TITLE, "How earlier turns are kept");
  assert.deepEqual(howLevels({ chat: true }).map((l) => [l.id, l.label]), [["chat", "This chat"], ["yours", "All new chats"]]);
  assert.deepEqual(howLevels({ chat: false }).map((l) => l.id), ["yours"], "no chat: your defaults alone");
});

test("the section draws again only when what it shows moved — a settings write, a turn — or when told (a compaction or its Undo)", async () => {
  const w = world();
  await settle();
  const before = w.s.el.kids;
  w.s.repaint();
  await settle();
  assert.equal(w.s.el.kids, before, "nothing moved: the section stays as it is, under the cursor");
  w.state.hash = "h2";
  w.s.repaint();
  await settle();
  assert.notEqual(w.s.el.kids, before, "a settings write draws it again");
  const after = w.s.el.kids;
  w.s.repaint(true);
  await settle();
  assert.notEqual(w.s.el.kids, after, "a compaction moved neither: told, it draws again");
});

// (fails before: yes — the section knew the session by its settings and its count of turns, and the page counts a turn
// from its start: in the live drive of 2026-10-11 the open section still read what the turn before had left, after a
// turn that had left more)
test("a turn's end draws the section again: the host names the state its preview answers for, and that moves when the turn ends, not when it starts", async () => {
  const w = world();
  // The host's key as the page makes it: the turns that have ended.
  let ended = 1;
  w.ctx.previewKey = () => `c1|h1|${ended}|0`;
  const s = w.make();
  await settle();
  advanced({ s });
  const before = s.el.kids;
  w.state.turns = [{ n: 1 }, { n: 2 }];
  s.repaint();
  await settle();
  assert.equal(s.el.kids, before, "a turn that started moved nothing the section shows");
  w.state.preview = { ...w.state.preview, compaction: { ...PLAN, methods: { ...PLAN.methods, summary: { ...PLAN.methods.summary, after: 7_000 } } } };
  ended = 2;
  s.repaint();
  await settle();
  assert.notEqual(s.el.kids, before, "its end did");
  assert.ok(textOf(s.el).includes("≈7K after"), textOf(s.el).slice(0, 600));
});

// (proposal_ux R2, M5: the Context pane's parts went to the Run pane and the Next request pane; the sheet's door is
// Overview's How earlier turns are kept, and the Context widget's)
test("the page's wiring: Overview's tile opens the sheet, which draws the section from the widgets' context; the run's pulse refreshes the panes in place; the section repaints with the session view, a compaction and its Undo", () => {
  const src = (/** @type {string} */ f) => readFileSync(new URL(`../src/ui/harness/${f}`, import.meta.url), "utf8");
  const app = src("app.js");
  assert.match(app, /\{ id: "run", label: "Run", [^\n]*render: \(body, ctx\) => renderRun\(body, runCtx\(ctx\)\), refresh: \(body, ctx\) => refreshRun\(body, runCtx\(ctx\)\) \}/);
  assert.match(app, /\{ id: "next-request", label: "Next request", [^\n]*render: \(body, ctx\) => renderNextRequest\(body, nextRequestCtx\(ctx\)\), refresh: \(body, ctx\) => refreshNextRequest\(body, nextRequestCtx\(ctx\)\) \}/);
  assert.match(app, /openHow: \(\) => openHow\(\),/, "the widgets' door to the sheet");
  assert.match(src("widgets/overview-setup.js"), /sheet: \(\) => ctx\.openHow\?\.\(\),/, "How earlier turns are kept's tile opens it");
  assert.match(app, /openHowSheet\(\{\s*how: c \? widgetContext : null,\s*chainId: c \? String\(c\.chainId\) : null,\s*models:/, "the open chat's section, over the widgets' context");
  assert.match(app, /onSessionView\(chat, \(\) => \{[^\n]*repaintContextHow\(\);/, "the session view moved");
  assert.match(app, /placeCompaction\(chat, r\.boundary\);\s*widgets\.paint\(\);\s*repaintContextHow\(true\);/, "Compact now landed");
  assert.match(app, /afterCompactionUndo[\s\S]{0,200}widgets\.paint\(\);\s*repaintContextHow\(true\);/, "Undo landed");
  const host = src("panes/pane-host.js");
  assert.match(host, /pulseTimer = setTimeout\(\(\) => \{ pulseTimer = null; refresh\(\); \}, 1200\);/);
  assert.match(host, /function refresh\(\) \{\s*syncKey\(\);\s*const top = topNow\(\);\s*for \(const v of \[\.\.\.\(look\.on \? shownViews\(\) : \[\]\), \.\.\.\(top \? \[top\] : \[\]\)\]\) if \(!refreshTile\(v\)\) drawTile\(v, true\);\s*\}/, "each tile in place where its pane can, and the pane on top");
  assert.match(host, /if \(!pane\?\.refresh \|\| v\.chat !== chat \|\| !v\.body\.firstChild\) return false;/, "drawn for this chat, and drawn at all");
  const run = src("panes/run-pane.js");
  assert.doesNotMatch(run, /howSection/, "the section is the sheet's");
  assert.match(run, /renderRun\(body, ctx\);\s*return;\s*\}\s*refreshPart\(box, ctx\);/, "drawn again in place");
  assert.doesNotMatch(run, /activeElement/, "typed in too: Calls' search is never drawn over (run-in-place.test.js)");
  assert.match(src("panes/next-request.js"), /export function refreshNextRequest\(body, ctx\) \{\s*const draw = drawers\.get\(body\);\s*if \(draw\) return draw\(\);/, "read again in place");
  const sheet = src("how-sheet.js");
  assert.match(sheet, /shown = howSection\(o\.how, \{ key: String\(o\.chainId\) \}\);/, "the chat's section, drawn again with the session");
  assert.match(sheet, /export function repaintContextHow\(force = false\) \{\s*shown\?\.repaint\(force\);\s*\}/);
});

// (fails before: yes — HarnessV4_Tasks U3, V4-D216: a reload brings the turns without their records, so the anatomy
// under the section said "No reply yet." over a session with replies; mid-turn it pointed at the composer instead)
test("Run › Calls' record: the newest finished reply's, read once where the page has none; mid-turn, the reply before", async () => {
  const { anatomyTurn } = await import("../src/ui/harness/panes/last-reply.js");
  const first = { n: 1, status: "done", requestId: "r1", facts: { held: 10_000 } };
  const command = { n: 2, status: "done", command: true, requestId: "r2" };
  const running = { n: 3, status: "streaming", requestId: "r3" };
  assert.equal(anatomyTurn([first, command, running]), first, "a command and the running turn have no anatomy of their own");
  assert.equal(anatomyTurn([running]), null, "the first reply is still running");
  assert.equal(anatomyTurn([]), null);
  const pane = readFileSync(new URL("../src/ui/harness/panes/last-reply.js", import.meta.url), "utf8");
  assert.match(pane, /api\(`\/requests\/\$\{encodeURIComponent\(String\(turn\.requestId\)\)\}`\)/, "the record read as the meter reads it");
  assert.match(pane, /const records = new WeakMap\(\);/, "once per turn");
  assert.doesNotMatch(pane, /the true anatomy lands/);
});

// (fails before: yes — HarnessV4_Envelopes_Plan EN5: subagents.envelopes had no control on the page, only /set; and
// as a session knob your defaults could not hold it)
test("Other agents' results: Sealed or Whole while your agent works — in Filament's chats, a coding agent's and your defaults; a client's has none", async () => {
  const w = world();
  await settle();
  const part = partOf(w.s.el, "results");
  assert.ok(part, "the part is on the face");
  assert.ok(textOf(part).startsWith("Other agents' results|While your agent works|another agent's result|Sealed|Whole"), textOf(part));
  assert.deepEqual(onOf(rowOf(w.s.el, "envelopes")), ["Sealed"], "sealed by default (EN-Q1)");
  assert.match(button(rowOf(w.s.el, "envelopes"), "Sealed").attrs.title, /^One line with who sent it and its subject; the agent opens it when it reaches a stopping point/);
  assert.equal(button(rowOf(w.s.el, "envelopes"), "Whole").attrs.title, "The whole report joins the agent's next request, wherever it is in its work");
  button(rowOf(w.s.el, "envelopes"), "Sealed").dispatch("click");
  assert.equal(w.did.length, 0, "the value it has: nothing written");
  button(rowOf(w.s.el, "envelopes"), "Whole").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"subagents":{"envelopes":"whole"}}}');
  // Changed in this chat: it says so, and Use yours takes it back.
  const whole = world({ flat: { "subagents.envelopes": "whole" }, sources: { "subagents.envelopes": "session" } });
  await settle();
  assert.deepEqual(onOf(rowOf(whole.s.el, "envelopes")), ["Whole"]);
  assert.ok(textOf(rowOf(whole.s.el, "envelopes")).includes("↳ Changed here · |Use yours"), textOf(rowOf(whole.s.el, "envelopes")));
  button(rowOf(whole.s.el, "envelopes"), "Use yours").dispatch("click");
  assert.equal(whole.did.at(-1), 'write {"unset":["subagents.envelopes"]}');
  // A coding agent that has Filament's tools seals them too (EN3); a client runs no loop of Filament's to reach.
  const agent = world({ agent: true, agentName: "Claude Code", facts: claudeFacts(), preview: agentPlan() });
  await settle();
  assert.ok(partOf(agent.s.el, "results"), "a coding agent's chat has it");
  const client = opencode();
  await settle();
  assert.equal(partOf(client.s.el, "results"), null, "a client's has none");
  // Your defaults: the same row, and where its value comes from.
  const mine = world({ flat: { "subagents.envelopes": "whole" }, sources: { "subagents.envelopes": "session" }, preview: {}, key: "defaults-env" });
  const s = howSection(mine.ctx, { h: fakeH, drawIn: fakeDrawIn, key: "defaults-env", modelSelect: () => ({ el: fakeH("button", {}, "chip"), setModels() {}, set() {}, setNote() {}, setLocked() {} }), defaults: () => ({ preset: null }) });
  await settle();
  assert.deepEqual(onOf(rowOf(s.el, "envelopes")), ["Whole"]);
  assert.ok(textOf(rowOf(s.el, "envelopes")).includes("↳ Your default · |Reset"), textOf(rowOf(s.el, "envelopes")));
  // The knob is how you work: your defaults may hold it, as the page's switch needs.
  const { scopeOf, applyPatch } = await import("../src/services/session-settings.js");
  assert.equal(scopeOf("subagents.envelopes"), "mode");
  assert.deepEqual(applyPatch({}, { patch: { subagents: { envelopes: "whole" } }, unset: [] }, { at: "global" }).errors, []);
});
