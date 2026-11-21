// HarnessV3 Compaction methods, Phase 3 (the vault's HarnessV3-Compaction.md §3, §7), where the page draws them since
// the Compaction pill and its popover went (HarnessV4_Tasks U3-4), and as the owner's rules of 10-31 leave them — one
// summary by the same model or a side model, or an instant fold: the Context tab's section and the context ring's
// popover, on the fake DOM — what the method in force would leave and why it cannot run, the compactions so far with
// Undo, Compact now… bringing the card up, the instant fold's offer with its count; each method weighed on the plan,
// each method's own control and the instant line, who writes a summary and how it reads the turns — and the card's
// choices, and the words a compaction's row says. A client's session: how Filament answers its compaction. In a coding
// agent's session (HarnessV3-ACP AC5-8): its way of making room with why and what it leaves, its ways for this once,
// the ways over Filament's methods.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { afterWords, askChoices, choiceCompaction, costWords, foldOfferWords, paceWords, isCold, methodThumb, METHODS, NOT_OFFERED, readsWords, sessionKind, sessionMethod, SIDE_NONE, wayNow, wayReason } from "../src/ui/harness/widgets/compaction.js";
import { contextWidget } from "../src/ui/harness/widgets/context.js";
import { howSection } from "../src/ui/harness/panes/context-how.js";
import { compactionFacts } from "../src/ui/harness/lib/labels.js";
import { pages } from "../src/ui/harness/widgets/kit.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { afterCompactionUndo } from "../src/ui/harness/conversation/history.js";
import { readFileSync } from "node:fs";

/** The compactor's plan as the preview carries it (`compaction`): a 200K window, 120K now, the same model's cache warm
 *  with room for a fork; a fold leaves 18K of the earlier turns, under the instant line. */
const PLAN = Object.freeze({
  native: true, now: 120_000, window: 200_000, line: 170_000, mode: "auto", method: "summary", writer: null, keepWhole: 1, instantTokens: 20_000, recommended: "session", fromTurn: 1, turns: 12,
  methods: {
    fold: { after: 96_000, exact: true, turns: 11, earlier: 18_000, calls: 0, cost: 0, possible: true, instant: true },
    summary: { after: 9_000, exact: false, headTurns: 12, transcriptTokens: 90_000, summaryTokens: 5400, reads: "fork", slices: 1, sliceBudget: 88_000, model: "claude-opus-5-5", fork: true, cost: 0.29, possible: true },
  },
  writers: {
    session: { after: 9_000, exact: false, headTurns: 12, transcriptTokens: 110_000, reads: "fork", slices: 1, model: "claude-opus-5-5", fork: true, cost: 0.29, possible: true, window: 200_000 },
    side: { after: 9_000, exact: false, headTurns: 12, transcriptTokens: 90_000, reads: "whole", slices: 1, model: "house-cheap", fork: false, cost: 0.23, possible: true, window: 128_000, windowSource: "assumed" },
    chosen: { model: "claude-opus-5-5", fork: true, why: "the session's model", cost: 0.29 },
    cache: { state: "warm", leftMs: 192_000, tokens: 110_000, model: "claude-opus-5-5", forkRoom: 20_000 },
  },
});

let keys = 0;
/** The widgets' context over a view the test drives, recording every write and action; `how()` draws the Context tab's
 *  section over it, `pop()` the context ring's popover. `native: false` is a client's session (OpenCode's chat opened
 *  here), `sources` which knobs the session chose; `agent` a coding agent's session, `facts` what its newest turn
 *  counted, `agentName` its accounts' name for the agent.
 * @param {{ flat?: Record<string, any>, preview?: any, hash?: string, native?: boolean, sources?: Record<string, string>, windows?: any[],
 *   agent?: boolean, facts?: any, agentName?: string }} [o] */
function world({ flat = {}, preview = { compaction: PLAN, compactions: [] }, hash = "h1", native = true, sources = {}, windows = [], agent = false, facts = { context: { held: 120_000 } }, agentName = "" } = {}) {
  const state = { flat: { "context.compaction.thresholdPercent": 85, ...flat }, preview, hash, turns: /** @type {any[]} */ ([{ n: 1 }]) };
  /** @type {string[]} */
  const did = [];
  /** @type {any} */
  const ctx = {
    view: () => ({ settings: { hash: state.hash, native, sources, window: { tokens: 200_000, source: "operator" }, flat: state.flat, effective: { context: { compaction: { mode: "auto" } } } }, facts, windows }),
    hasSession: () => true,
    live: () => ({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 4000, streaming: false, agent }),
    turns: () => state.turns,
    write: (/** @type {any} */ c) => did.push(`write ${JSON.stringify(c)}`),
    compact: (/** @type {any} */ m, /** @type {any} */ way, /** @type {any} */ once) => did.push(way ? `compact way ${way}${once ? " with a model" : ""}` : m ? `compact:${m}${once ? ` ${JSON.stringify(once)}` : ""}` : "compact"),
    summon: () => did.push("summon"),
    foldNow: () => did.push("fold now"),
    openHow: () => did.push("how"),
    stopAndCompact: () => did.push("stop and compact"),
    accounts: { session: () => (agentName ? { agentName } : null) },
    undoCompaction: (/** @type {any} */ id) => did.push(`undo:${id}`),
    preview: async () => state.preview,
    models: () => [{ id: "house-cheap", upstream: "u" }, { id: "cc/opus", upstream: "cc", codingAgent: true }],
    scrollToTurn: () => true,
    toast: () => {},
    dryRun: () => did.push("dry run"),
    openPane: (/** @type {string} */ id) => did.push(`pane ${id}`),
    openPane: (/** @type {string} */ p) => did.push(`pane ${p}`),
  };
  /** The Aqua picker, as a test hands it in: it records what it was given and what it would write. */
  const picked = { models: /** @type {any[]} */ ([]), set: "", onChange: /** @type {any} */ (null) };
  const modelSelect = (/** @type {any} */ cb) => {
    picked.onChange = cb.onChange;
    return { el: fakeH("button", { class: "model-chip" }, "chip"), setModels: (/** @type {any[]} */ m) => { picked.models = m; }, set: (/** @type {string} */ n) => { picked.set = n; }, setNote() {}, setLocked() {} };
  };
  /** The Context tab's section. @returns {any} */
  const how = () => howSection(ctx, { h: fakeH, drawIn: fakeDrawIn, key: `parts${++keys}`, modelSelect }).el;
  /** The context ring's popover: its Another way draws the picker too. @returns {any} */
  const pop = () => contextWidget(ctx, { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, modelSelect: /** @type {any} */ (modelSelect) }).panel?.(fakeH, () => did.push("closed"), () => {});
  return { state, did, ctx, picked, how, pop };
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
/** Every node under `el` whose class list holds `cls`. @param {any} el @param {string} cls @returns {any[]} */
const findAll = (el, cls, out = /** @type {any[]} */ ([])) => {
  if (!el || typeof el !== "object") return out;
  if (String(el.attrs?.class || "").split(/\s+/).includes(cls)) out.push(el);
  for (const k of el.kids || []) findAll(k, cls, out);
  return out;
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
const button = (/** @type {any} */ el, /** @type {string} */ starts) => buttonsOf(el).find((b) => textOf(b).replace(/^\|/, "").startsWith(starts));
/** A row's ▾: the button that opens its list. @param {any} el @param {string} id */
const pick = (el, id) => find(rowOf(el, id), "inst-how-pick");
/** A row of the section, its list opened. @param {any} el @param {string} id */
const opened = (el, id) => {
  pick(el, id).dispatch("click");
  return rowOf(el, id);
};
/** The section, Advanced opened: how room is made and the compactions wait under it (HarnessV4_Tasks U11).
 *  @param {any} el */
const advanced = (el) => {
  if (button(el, "Advanced")?.attrs?.["aria-expanded"] !== "true") button(el, "Advanced").dispatch("click");
  return el;
};

test("the method in force with what it would leave, and who writes it at what cost; the newest compaction alone has Undo; Compact now… brings the card up", async () => {
  const preview = { compaction: PLAN, compactions: [{ id: 6, fromTurn: 1, toTurn: 3, kind: "plain", method: "summary" }, { id: 7, fromTurn: 1, toTurn: 6, kind: "manual", method: "fold", at: Date.now(), detail: { before: 150_000, after: 96_000, exact: true, how: "local" }, undoable: true }] };
  const w = world({ preview });
  const el = w.how();
  await settle();
  for (const bit of ["Summaries written by|when Filament writes one", "≈$0.29 each time", "The same model"]) assert.ok(textOf(rowOf(el, "writer")).includes(bit), `${bit} in ${textOf(rowOf(el, "writer"))}`);
  // How it makes room and History on the face (proposal_ux §4.12 step 4): the way by its name.
  for (const bit of ["The way|the card's first choice", "≈9K after", "One summary"]) assert.ok(textOf(rowOf(el, "method")).includes(bit), `${bit} in ${textOf(rowOf(el, "method"))}`);
  const hist = partOf(el, "history");
  for (const bit of ["History|2 so far", "Turns 1–6 folded", "150k → 96k", "Turns 1–3 summarized"]) assert.ok(textOf(hist).includes(bit), `${bit} in ${textOf(hist)}`);
  assert.equal(buttonsOf(el).filter((b) => textOf(b) === "Undo").length, 1, "Undo on the newest alone");
  button(el, "Undo").dispatch("click");
  assert.equal(w.did.at(-1), "undo:7");
  // Compact now… on the ring's popover brings the card up, which lists every way (V9: Another way left the popover).
  const body = w.pop();
  await settle();
  assert.equal(button(body, "Another way"), undefined);
  assert.equal(find(body, "inst-other"), null);
  button(body, "Compact now…").dispatch("click");
  assert.deepEqual(w.did.slice(-2), ["closed", "summon"], "a press never compacts (D6)");
  button(body, "How earlier turns are kept").dispatch("click");
  assert.deepEqual(w.did.slice(-2), ["closed", "how"], "the sheet");
});

// (fails before: yes — the owner's rules of 10-31: "the tokens left are shown in advance; an offer with its count is
// visible any time" — the popover named no fold, and Compact now… was the only way to one)
// (fails before: yes — the owner's of 11-05: "sometimes the tokens are ever so slightly above 20K so if i want i can just
// go and select that strategy myself": over the line no Fold now stood)
test("the ring's popover offers the instant fold with its count where it leaves the earlier turns at the line or under; over it too, saying so", async () => {
  const w = world();
  const body = w.pop();
  await settle();
  assert.equal(textOf(find(body, "inst-fold-offer")), "Instant fold: leaves 18K of the earlier turns, no model call|Fold now");
  button(body, "Fold now").dispatch("click");
  assert.deepEqual(w.did.slice(-2), ["closed", "fold now"]);
  const over = world({ preview: { compaction: { ...PLAN, methods: { ...PLAN.methods, fold: { ...PLAN.methods.fold, earlier: 31_000, instant: false } } }, compactions: [] } });
  const b2 = over.pop();
  await settle();
  assert.equal(textOf(find(b2, "inst-fold-offer")), "A fold leaves 31K of the earlier turns, over your 20K instant line — no model call|Fold now");
  button(b2, "Fold now").dispatch("click");
  assert.deepEqual(over.did.slice(-2), ["closed", "fold now"], "offered over the line too");
  const none = world({ preview: { compaction: { ...PLAN, methods: { ...PLAN.methods, fold: { ...PLAN.methods.fold, possible: false, instant: false, why: "folding frees nothing" } } }, compactions: [] } });
  const b3 = none.pop();
  await settle();
  assert.ok(find(b3, "inst-fold-offer").classList.contains("hidden"), "a fold that frees nothing is no offer");
  assert.equal(foldOfferWords({ possible: true, earlier: 31_000, instant: false }, 0), "Instant fold is off; a fold would leave 31K of the earlier turns");
  // The instant fold switched off stays off: no Fold now.
  const offW = world({ preview: { compaction: { ...PLAN, instantTokens: 0, methods: { ...PLAN.methods, fold: { ...PLAN.methods.fold, earlier: 31_000, instant: false } } }, compactions: [] } });
  const b4 = offW.pop();
  await settle();
  assert.equal(button(b4, "Fold now"), undefined);
});

// (fails before: yes — the row quoted a method's figures even when it could not run)
test("the row says why the method in force cannot run now, instead of what it would leave", async () => {
  const why = "no finished turn to summarize";
  const plan = { ...PLAN, methods: { ...PLAN.methods, summary: { ...PLAN.methods.summary, possible: false, why } } };
  const w = world({ preview: { compaction: plan, compactions: [] } });
  const el = advanced(w.how());
  await settle();
  const text = textOf(rowOf(el, "method"));
  assert.ok(text.includes(`↳ Can't run now: ${why}`), text);
  assert.ok(!text.includes("≈9K after"), "no figures for a way that cannot run");
});

// (fails before: yes — the owner's rules of 10-31: the list weighed five ways against a target, Least lossy and the
// tail among them; it holds the two methods, and the fold says what it leaves of the earlier turns)
test("the methods' list: one summary and the instant fold, ≈ for a stand-in, the fold with what it leaves of the earlier turns; one that cannot run says why and writes nothing; choosing writes the method", async () => {
  const plan = { ...PLAN, methods: { ...PLAN.methods, fold: { after: 120_000, exact: true, turns: 11, earlier: 40_000, calls: 0, cost: 0, possible: false, instant: false, why: "folding frees nothing: every older turn already goes as its fold or smaller" } } };
  const w = world({ preview: { compaction: plan, compactions: [] } });
  const el = advanced(w.how());
  await settle();
  const row = opened(el, "method");
  const text = textOf(row);
  for (const bit of ["One summary", "Every finished turn since the last summary becomes one summary.", "≈9K", "Instant fold", "folding frees nothing"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  for (const gone of ["Make room down to", "✓", "✗", "newest 4 turns"]) assert.ok(!text.includes(gone), `no ${gone}`);
  const rows = findAll(row, "inst-method-row");
  assert.deepEqual(rows.map((r) => r.attrs["aria-checked"]), ["true", "false"], "One summary is in force");
  assert.equal(rows[1].attrs["aria-disabled"], "true");
  rows[1].dispatch("click");
  assert.deepEqual(w.did, [], "a method that cannot run writes nothing");
  assert.equal(find(row, "inst-method-tick"), null, "no target's tick");
  // A fold over the instant line still runs when it is chosen: the line is the card's offer.
  const over = world({ preview: { compaction: { ...PLAN, methods: { ...PLAN.methods, fold: { ...PLAN.methods.fold, earlier: 31_000, instant: false, instantWhy: "it leaves ≈31,000 tokens of the earlier turns, over the 20,000 an instant fold may leave" } } }, compactions: [] } });
  const e2 = advanced(over.how());
  await settle();
  const r2 = opened(e2, "method");
  assert.ok(textOf(r2).includes("Free · no model call · leaves 31K of the earlier turns, over the instant line: the card offers it, never recommends it"), textOf(r2));
  findAll(r2, "inst-method-row")[1].dispatch("click");
  assert.equal(over.did.at(-1), 'write {"patch":{"context":{"compaction":{"method":"fold"}}}}');
});

// (fails before: yes — the instant line had no control: it is a setting, default 20K, the owner's rules of 10-31)
test("each method's own control, under Advanced: keep whole on fold; the instant line beside either; the writer only where a summary is written", async () => {
  const fold = world({ flat: { "context.compaction.method": "fold" } });
  let el = fold.how();
  await settle();
  button(el, "Advanced").dispatch("click");
  let adv = find(el, "inst-how-advanced");
  assert.ok(textOf(adv).includes("Keep whole"), textOf(adv));
  assert.ok(textOf(adv).includes("Instant fold up to|What a fold may leave of the earlier turns, for the card to offer it · A fold now leaves 18K of them"), textOf(adv));
  assert.equal(rowOf(el, "writer"), null, "a fold has no writer");
  buttonsOf(adv).find((b) => textOf(b) === "2").dispatch("click");
  assert.equal(fold.did.at(-1), 'write {"patch":{"context":{"compaction":{"keepWhole":2}}}}');
  const instantSeg = (/** @type {any} */ a) => findAll(a, "inst-seg").find((x) => x.attrs["aria-label"] === "The most an instant fold may leave of the earlier turns");
  assert.deepEqual(buttonsOf(instantSeg(adv)).map((b) => textOf(b)), ["Off", "10K", "20K", "40K"]);
  buttonsOf(adv).find((b) => textOf(b) === "40K").dispatch("click");
  assert.equal(fold.did.at(-1), 'write {"patch":{"context":{"compaction":{"instantTokens":40000}}}}');
  const summary = world({ flat: { "context.compaction.instantTokens": 15_000 } });
  el = summary.how();
  await settle();
  button(el, "Advanced").dispatch("click");
  adv = find(el, "inst-how-advanced");
  assert.ok(!textOf(adv).includes("Keep whole"), "one summary keeps nothing whole");
  assert.deepEqual(buttonsOf(instantSeg(adv)).map((b) => textOf(b)), ["Off", "10K", "15K", "20K", "40K"], "the session's own line among the steps");
  buttonsOf(adv).find((b) => textOf(b) === "Off").dispatch("click");
  assert.equal(summary.did.at(-1), 'write {"patch":{"context":{"compaction":{"instantTokens":0}}}}');
  assert.ok(textOf(rowOf(el, "writer")).includes("Summaries written by"));
});

// (fails before: yes — nothing showed who writes a summary, what each writer costs, or how long the cache stays warm;
// the owner's rules of 10-31: the writer is the same model or a side model, and a side model's reading is said)
test("who writes a summary: the same model and the side model side by side with their cost, how each reads, the cache's time left and the windows (assumed, said); the choice written; a named side model through the picker", async () => {
  const w = world();
  const el = w.how();
  await settle();
  const row = opened(el, "writer");
  const text = textOf(row);
  for (const bit of ["Summaries written by", "Same model", "Side model", "claude-opus-5-5", "Same model · warm cache, 3:12 left", "≈ $0.29", "house-cheap", "Side model · 128K assumed · Reads the turns whole", "≈ $0.23"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  assert.ok(!text.includes("Cheaper"), "no cheaper-at-the-moment writer");
  assert.ok(find(row, "inst-writer-row").classList.contains("is-on"), "the same model writes it (today's rule)");
  // On a subscription plan (Providers P4): what is paid, and the list price beside it.
  const sub = world({ preview: { compaction: { ...PLAN, writers: { ...PLAN.writers, session: { ...PLAN.writers.session, cost: 0, listCost: 0.29 }, side: { ...PLAN.writers.side, cost: 0, listCost: null } } }, compactions: [] } });
  const es = sub.how();
  await settle();
  const subText = textOf(opened(es, "writer"));
  assert.ok(subText.includes("On your plan · ≈ $0.29 at list price"), subText);
  assert.ok(!subText.includes("unpriced"), "a plan model nobody prices still pays $0");
  buttonsOf(row).find((b) => textOf(b) === "Side model").dispatch("click");
  assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"writer":"model"}}}}');
  // The side model, none named: memory's model writes, said; one named: the picker, a coding agent's models among
  // the others (HarnessV4_Tasks C33), and its pick written.
  const side = world({ flat: { "context.compaction.writer": "model" } });
  const e1 = side.how();
  await settle();
  assert.ok(textOf(opened(e1, "writer")).includes("Side model|Now memory's model, house-cheap"), textOf(rowOf(e1, "writer")));
  const named = world({ flat: { "context.compaction.writer": "model", "context.compaction.model": "house-cheap" } });
  const e2 = named.how();
  await settle();
  assert.ok(textOf(opened(e2, "writer")).includes("Side model"));
  assert.deepEqual(named.picked.models.map((m) => m.id), ["house-cheap", "cc/opus"], "a coding agent's model can be picked as the writer");
  assert.equal(named.picked.set, "house-cheap");
  named.picked.onChange("grok-4.6");
  assert.equal(named.did.at(-1), 'write {"patch":{"context":{"compaction":{"model":"grok-4.6"}}}}');
  // Warm but too full: said, and no fork's price; a side model the turns are too big for whole reads them folded.
  const full = world({ preview: { compaction: { ...PLAN, writers: { ...PLAN.writers, session: { ...PLAN.writers.session, fork: false, reads: "whole", cost: 0.51 }, side: { ...PLAN.writers.side, reads: "folded" }, cache: { ...PLAN.writers.cache, forkRoom: null } } }, compactions: [] } });
  const e3 = full.how();
  await settle();
  const t3 = textOf(opened(e3, "writer"));
  assert.ok(t3.includes("Same model · cache too full for a summary · Reads the turns whole"), t3);
  assert.ok(t3.includes("Reads the turns with their tool calls folded: too big whole for one call"), t3);
  // (fails before: yes — the review of 10-31: a coding agent as the side model was said nowhere on its row)
  const agentSide = world({ preview: { compaction: { ...PLAN, writers: { ...PLAN.writers, side: { ...PLAN.writers.side, model: "cc/opus", agentWriter: true } } }, compactions: [] } });
  const e4 = agentSide.how();
  await settle();
  assert.ok(textOf(opened(e4, "writer")).includes("Side model · a coding agent, in a session of its own · 128K assumed"), textOf(rowOf(e4, "writer")));
});

// (fails before: yes — the review of 10-31: the row priced a summary as its writer would read the whole transcript,
// where the side model reads the turns folded, or the instant fold stands in for it at no cost)
test("Summaries written by prices the summary as its writer reads the turns: folded at its own price, the instant fold free", async () => {
  /** @param {any} summary */
  const figOf = async (summary) => {
    const w = world({ flat: { "context.compaction.writer": "model" }, preview: { compaction: { ...PLAN, methods: { ...PLAN.methods, summary: { ...PLAN.methods.summary, ...summary } }, writers: { ...PLAN.writers, chosen: { model: "house-cheap", fork: false, why: "memory's cheap model", cost: 0.61 } } }, compactions: [] } });
    const el = w.how();
    await settle();
    return textOf(rowOf(el, "writer"));
  };
  const folded = await figOf({ model: "house-cheap", fork: false, reads: "folded", cost: 0.04 });
  assert.ok(folded.includes("≈$0.04 each time") && !folded.includes("0.61"), folded);
  const instant = await figOf({ model: "house-cheap", fork: false, reads: "instant", cost: 0, listCost: 0 });
  assert.ok(instant.includes("free, no model call") && !instant.includes("each time"), instant);
});

// (fails before: yes — the owner's rules of 10-31: an outside client gets a plain proxy plus memory, so Filament never
// answers its compaction: the row offered Filament's ways, a writer and Advanced, one summary by /trim's summarizer in
// force though nothing was chosen)
test("a client's session (HarnessV3-Compaction §7.3): one still row — its client compacts by itself, its own model writing the summary; no line, no Ask first, no ways, no Advanced", async () => {
  const w = world({ native: false, preview: { compactions: [] } });
  assert.equal(sessionMethod(w.ctx.view()), null, "no method of Filament's in a client's session");
  const el = w.how();
  await settle();
  const t = textOf(el);
  assert.ok(t.includes("The way|Your client compacts by itself|Your client's own"), `who compacts, and that it is its own — ${t}`);
  assert.ok(!/Filament can answer|One summary|Instant fold|Nothing chosen|\/trim/.test(t), t);
  assert.ok(!t.includes("at 85%"), "the client decides when: no line of Filament's");
  assert.equal(button(el, "Ask first"), undefined, "ask-first stops a harness turn; a client's compaction never waits on it");
  assert.equal(rowOf(el, "writer"), null, "nothing of Filament's writes");
  assert.equal(findAll(el, "inst-how-more").length, 0, "no Advanced: nothing of Filament's to tune");
  // With no figures (the preview failed) the row says the same.
  const bare = world({ native: false });
  bare.ctx.preview = () => Promise.reject(new Error("no figures"));
  const e2 = bare.how();
  await settle();
  assert.ok(textOf(rowOf(e2, "method")).includes("The way|Your client compacts by itself|Your client's own"), textOf(rowOf(e2, "method")));
});

// (fails before: yes — OpenCode's chat the harness had typed into drew the harness's rows, its line and Compact now; the
// harness takes no turn in a client's chat, which goes on in a fork)
test("a client's chat the harness typed into before is its client's: its client compacts it, no line of Filament's, no Compact now", async () => {
  const windows = [{ window: "zc:rt", client: "opencode", clientLabel: "OpenCode" }, { window: "harness", client: "harness", clientLabel: "the harness" }];
  const w = world({ native: false, windows, preview: { compaction: PLAN, compactions: [] } });
  const el = w.how();
  await settle();
  const t = textOf(el);
  assert.ok(t.includes("The way|OpenCode compacts by itself|OpenCode's own"), t);
  assert.ok(!t.includes("at 85%") && rowOf(el, "line") === null, "the client decides when: no line of Filament's");
  assert.equal(button(w.pop(), "Compact now"), undefined, "nothing of Filament's compacts it");
});

/** The plan with its same model's cache gone cold: no fork, its turns read whole again, the side model recommended. */
const COLD_PLAN = Object.freeze({
  ...PLAN, recommended: "model",
  writers: { ...PLAN.writers, session: { ...PLAN.writers.session, reads: "whole", fork: false, cost: 0.51 }, cache: { state: "cold", leftMs: 0, tokens: 110_000, model: "claude-opus-5-5", forkRoom: null } },
});
/** The card's choices for a plan of Filament's loop. @param {any} plan @param {string | null} [chosen] */
const kindsOf = (plan, chosen = null) => askChoices({ plan, agent: false, agentName: "", now: 0, chosen });

// (fails before: yes — the owner's rules of 10-31: the card offered five ways against a target, Least lossy and the
// tail among them; it offers the three kinds — the same model recommended while its cache is warm, the side model once
// it is cold — with the instant fold, and the same model costly on a cold cache)
test("askChoices: the three kinds — warm, the same model first and recommended; cold, the side model, the fold, then the same model, costly; each with what it leaves, costs, takes and how it reads", () => {
  const warm = kindsOf(PLAN);
  assert.deepEqual(warm.map((x) => [x.id, x.recommended, x.disabled, x.tag]), [["same", true, false, "Recommended"], ["side", false, false, ""], ["fold", false, false, ""]]);
  assert.deepEqual(warm.map((x) => x.label), ["Same model", "Side model", "Instant fold"]);
  // A summary's figure is a guess, said no more (the owner's word of 10-24); a fold's is the composition itself.
  assert.deepEqual(warm.map((x) => x.sub), ["≈ $0.29 · 1 call · claude-opus-5-5 · from the cache", "≈ $0.23 · 1 call · house-cheap", "96K after · Free · no model call"]);
  assert.deepEqual(warm.map((x) => x.note), ["From its warm cache", "Reads the turns whole", "Leaves 18K of the earlier turns"]);
  assert.deepEqual(warm.map((x) => [x.pace, x.writes, x.folds, x.main]), [["", false, false, true], ["", true, false, true], ["instant", false, true, true]], "the side model picked on the card writes the side's");
  const cold = kindsOf(COLD_PLAN);
  assert.deepEqual(cold.map((x) => [x.id, x.recommended, x.tag]), [["side", true, "Recommended"], ["fold", false, ""], ["same", false, "Costly"]]);
  assert.deepEqual([cold[2].sub, cold[2].note], ["≈ $0.51 · 1 call · claude-opus-5-5", "Reads the turns whole"], "the whole history read again, at its price");
  // (fails before: yes — the owner's rules of 10-31: the card had no kind of the session's own) The kind the session
  // chose is chosen first, whatever the cache says, and still says what it costs.
  assert.deepEqual(kindsOf(PLAN, "fold").map((x) => [x.id, x.recommended]), [["fold", true], ["same", false], ["side", false]]);
  assert.deepEqual(kindsOf(COLD_PLAN, "same").map((x) => [x.id, x.recommended, x.tag]), [["same", true, "Costly"], ["side", false, ""], ["fold", false, ""]]);
  assert.deepEqual(kindsOf(PLAN, "side").filter((x) => x.recommended).map((x) => x.id), ["side"]);
  assert.equal(askChoices({ plan: { native: false }, agent: false, agentName: "", now: 0 }).length, 0, "a client's session: no ways of Filament's");
  assert.deepEqual(askChoices({ plan: null, agent: false, agentName: "", now: 0 }), []);
});

// (fails before: yes — the owner's of 11-06: where what the chat sends ahead changed, "the recommended would could either
// be instant fold or the side model compaction")
test("askChoices where what the chat sends ahead changed: the instant fold recommended, else the side model — the kind the session chose where it is one of them", () => {
  /** @param {any} plan @param {string | null} [chosen] */
  const changed = (plan, chosen = null) => askChoices({ plan, agent: false, agentName: "", now: 0, chosen, changed: true });
  assert.deepEqual(changed(PLAN).map((x) => [x.id, x.recommended]), [["fold", true], ["same", false], ["side", false]], "a warm cache's same model is not what a change asks for");
  assert.deepEqual(changed(PLAN, "side").filter((x) => x.recommended).map((x) => x.id), ["side"]);
  assert.deepEqual(changed(PLAN, "same").filter((x) => x.recommended).map((x) => x.id), ["fold"]);
  const over = { ...PLAN, methods: { ...PLAN.methods, fold: { ...PLAN.methods.fold, instant: false } } };
  assert.deepEqual(changed(over).filter((x) => x.recommended).map((x) => x.id), ["side"], "a fold past the instant line is offered, never recommended");
});

// (fails before: yes — the owner's rules of 10-31: "offered when the result is 20K or less"; a side model's turns too
// big for its window fold first, then go in slices only as the last resort)
// (fails before: yes — the owner's of 11-05: over the instant line the fold could not be chosen at all, "sometimes the
// tokens are ever so slightly above 20K")
test("askChoices: the fold offered wherever it frees room, recommended at the instant line or under alone; a kind that cannot run says why; the side model's reading — folded, in slices, or the fold in its place", () => {
  const instantWhy = "it leaves ≈31,000 tokens of the earlier turns, over the 20,000 an instant fold may leave";
  const over = { ...PLAN, instantTokens: 20_000, methods: { ...PLAN.methods, fold: { ...PLAN.methods.fold, earlier: 31_000, instant: false, instantWhy } } };
  const o = kindsOf(over, "fold");
  assert.deepEqual(o.map((x) => [x.id, x.recommended, x.disabled]), [["same", true, false], ["side", false, false], ["fold", false, false]], "over the line the fold is offered, never recommended: the cache's kind is chosen first, as before");
  assert.deepEqual([o[2].title, o[2].note, o[2].tag], [kindsOf(PLAN).find((x) => x.id === "fold")?.title, "Leaves 31K of the earlier turns, over your 20K instant line", ""], "what it does, as at the line; its note, how much it leaves");
  assert.match(o[2].sub, /Free · no model call$/, "its figures, as at the line");
  assert.equal(o[2].over, true, "past the line: the card never picks it for you");
  // The instant fold switched off (`instantTokens` 0) stays off the card.
  const offWhy = "an instant fold is off (context.compaction.instantTokens 0)";
  const off = kindsOf({ ...over, instantTokens: 0, methods: { ...over.methods, fold: { ...over.methods.fold, instantWhy: offWhy } } });
  assert.deepEqual([off[2].id, off[2].disabled, off[2].sub], ["fold", true, offWhy]);
  // (fails before: yes — the review of f1784963a: with nothing else to run, the card chose the fold past the line itself)
  const src = readFileSync(new URL("../src/ui/harness/conversation/interaction.js", import.meta.url), "utf8");
  assert.match(src, /return \(open\.find\(\(o\) => o\.recommended\) \|\| open\.find\(\(o\) => !o\.over\)\)\?\.id \|\| null;/, "chosen first: the recommended, else the first that is no fold past the line");
  assert.match(src, /chosen = compactWay\(\) \|\| \(canSend \? SEND : null\);/, "and Send only where no way can run");
  assert.deepEqual(kindsOf(over).map((x) => [x.id, x.recommended]), kindsOf({ ...over, methods: { ...over.methods, fold: { ...over.methods.fold, possible: false, why: "x" } } }).map((x) => [x.id, x.recommended]), "the recommendation is the one it was when the fold could not be chosen");
  // The side model, its turns too big whole: the fold in its place where that is under the line — free, instant.
  const inst = kindsOf({ ...PLAN, writers: { ...PLAN.writers, side: { ...PLAN.writers.side, reads: "instant", after: 96_000, exact: true, cost: 0, listCost: 0, slices: 0 } } }).find((x) => x.id === "side");
  assert.deepEqual([inst?.sub, inst?.pace, inst?.folds, inst?.note], ["96K after · Free · no model call", "instant", true, "Too big whole for one call: an instant fold in its place, no model call"]);
  // Folded and still too big: slices, one after another, about how long by the writer's measured speed.
  const sliced = kindsOf({ ...PLAN, writers: { ...PLAN.writers, side: { ...PLAN.writers.side, reads: "slices", slices: 8, cost: 0.12, aboutMs: 250_000 } } }).find((x) => x.id === "side");
  assert.deepEqual([sliced?.sub, sliced?.note], ["≈ $0.12 · 8 calls · house-cheap · one after another · about 4 min", "Reads the folded turns in 8 calls: too big for one"]);
  assert.equal(readsWords({ reads: "folded" }), "Reads the turns with their tool calls folded: too big whole for one call");
  // (fails before: yes — the review's: a client's side row said "in undefined calls", and every reading in slices
  // "folded") a transcript with no tool call to fold is read in slices as it came
  assert.equal(readsWords({ reads: "slices", folded: false, slices: 3 }), "Reads the turns in 3 calls: too big for one");
  assert.equal(readsWords({ reads: "slices" }), "Reads the folded turns in slices: too big for one");
  // (fails before: yes — the owner's rules of 10-31 took single pass, the one reading of a newest part)
  assert.equal(readsWords({ reads: "newest", folded: true }), "");
  // No side model to call: said, off; a summary that cannot run, why.
  const none = kindsOf({ ...PLAN, writers: { ...PLAN.writers, side: null } }).find((x) => x.id === "side");
  assert.deepEqual([none?.disabled, none?.sub, none?.writes], [true, SIDE_NONE, true]);
  const why = "no finished turn to summarize";
  const cannot = (/** @type {any} */ wr) => ({ ...wr, possible: false, why });
  const nothing = kindsOf({ ...PLAN, recommended: null, writers: { ...PLAN.writers, session: cannot(PLAN.writers.session), side: cannot(PLAN.writers.side) } });
  assert.deepEqual(nothing.map((x) => [x.id, x.disabled, x.sub]), [["fold", false, "96K after · Free · no model call"], ["side", true, why], ["same", true, why]], "no summary can run: the fold is chosen first");
  assert.equal(nothing[1].title, "No finished turn to summarize");
});

test("choiceCompaction and sessionKind: what a card's choice asks of the server, and the kind a session chose", () => {
  assert.deepEqual(choiceCompaction("same"), { method: "summary", way: null, once: { writer: "session" } });
  assert.deepEqual(choiceCompaction("side"), { method: "summary", way: null, once: { writer: "model" } });
  assert.deepEqual(choiceCompaction("side", "grok-4.6"), { method: "summary", way: null, once: { writer: "model", model: "grok-4.6" } }, "a side model picked on the card, for this once");
  assert.deepEqual(choiceCompaction("fold", "grok-4.6"), { method: "fold", way: null, once: null });
  assert.deepEqual([choiceCompaction("way:own"), choiceCompaction("way:self")].map((c) => c.way), ["own", "self"]);
  for (const id of ["send", "trim", "auto", "newest", "", null]) assert.deepEqual(choiceCompaction(id), { method: null, way: null, once: null }, String(id));
  const view = (/** @type {Record<string, any>} */ flat) => ({ settings: { native: true, flat } });
  assert.deepEqual([
    view({}), view({ "context.compaction.method": "fold" }), view({ "context.compaction.writer": "session" }), view({ "context.compaction.writer": "model" }),
    view({ "context.compaction.method": "fold", "context.compaction.writer": "session" }), view({ "context.compaction.method": "trim", "context.compaction.writer": "bogus" }),
  ].map(sessionKind), [null, "fold", "same", "side", "fold", null]);
});

// (fails before: yes — HarnessV4_Tasks U3, V4-D309: on a 7.3K chat the pull-down offered "One summary now ≈8K after",
// and no line said that way would leave the chat no smaller than it was)
describe("a way that would leave the chat no smaller says so on its line, and stays on offer (V4-D309)", () => {
  /** A 7.3K chat: folding frees room; the side model's summary would leave as much, the same model's more. */
  const SMALL = Object.freeze({
    ...PLAN, now: 7_300,
    methods: { fold: { ...PLAN.methods.fold, after: 5_000 }, summary: { ...PLAN.methods.summary, after: 8_000 } },
    writers: { ...PLAN.writers, session: { ...PLAN.writers.session, after: 8_000 }, side: { ...PLAN.writers.side, after: 7_300 } },
  });

  test("the card's kinds: the words after the figure, each still offered", () => {
    assert.deepEqual(kindsOf(SMALL).map((c) => [c.id, c.sub, c.disabled]), [
      ["same", "no smaller than now · ≈ $0.29 · 1 call · claude-opus-5-5 · from the cache", false],
      ["side", "no smaller than now · ≈ $0.23 · 1 call · house-cheap", false],
      ["fold", "5K after · Free · no model call", false],
    ]);
    assert.equal(kindsOf(SMALL).find((c) => c.recommended)?.id, "same", "the cache's kind is still chosen first: the person decides");
    assert.equal(kindsOf(PLAN).some((c) => c.sub.includes("no smaller")), false, "120K now: every kind frees room");
    assert.equal(kindsOf({ ...SMALL, now: undefined }).some((c) => c.sub.includes("no smaller")), false, "no figure for now: nothing said");
  });

  test("in a coding agent's session its own share counts toward \"no smaller\", which its fresh session holds too, and is never said", () => {
    const t = Date.now();
    const plan = {
      ...SMALL, now: 36_000,
      methods: { ...SMALL.methods, fold: { ...SMALL.methods.fold, after: 1_000 }, summary: { ...SMALL.methods.summary, after: 3_000 } },
      agent: { own: null, self: "fork", opens: false, share: 33_000, warmUntil: t + 60_000, held: 36_000 },
    };
    const rows = askChoices({ plan, agent: true, agentName: "Claude Code", now: t });
    assert.equal(rows.find((r) => r.id === "way:self")?.sub, "No smaller than now · in a fork, read-only", "its guess and its 33K: no room");
    assert.equal(rows.find((r) => r.id === "fold")?.sub, "1K after · Free · no model call", "1K and its 33K: 2K freed");
    assert.equal(afterWords({ after: 3_000, exact: false }, { share: null }, 36_000), "", "no share measured, and a guess: nothing");
  });

  test("the How list's rows and the sheet's The way row say it too", async () => {
    const w = world({ preview: { compaction: SMALL, compactions: [] } });
    const el = advanced(w.how());
    await settle();
    const full = textOf(rowOf(el, "method"));
    for (const bit of ["The way", "One summary", "≈8K after", "↳ No smaller than now (7.3K)"]) assert.ok(full.includes(bit), `${bit} in ${full}`);
    const rows = findAll(opened(el, "method"), "inst-method-row");
    const said = rows.filter((r) => textOf(r).includes("no smaller than now")).map((r) => textOf(find(r, "inst-row-label")));
    assert.deepEqual(said, ["One summary"]);
    const roomy = advanced(world().how());
    await settle();
    assert.ok(!textOf(rowOf(roomy, "method")).includes("No smaller"), textOf(rowOf(roomy, "method")));
  });
});

test("paceWords: a summary's calls one after another, and about how long by its writer's measured speed; nothing where no time is known", () => {
  assert.equal(paceWords({ slices: 8, aboutMs: 250_000 }), "one after another · about 4 min");
  assert.equal(paceWords({ slices: 1, aboutMs: 42_000 }), "about 42 s");
  assert.equal(paceWords({ slices: 3, aboutMs: null }), "one after another", "no finished call of the writer in the log: no time is made up");
  assert.equal(paceWords({ slices: 1 }), "");
  assert.equal(paceWords({ slices: 20, aboutMs: 4_200_000 }), "one after another · about 1 h 10 min");
});

test("the words: each method's cost in a few words; a compaction row's figures; the thumbnails are numbers and the accent only", () => {
  assert.equal(costWords("fold", PLAN.methods.fold), "Free · no model call");
  assert.equal(costWords("summary", { ...PLAN.methods.summary, cost: 0, listCost: 0.29 }), "On your plan · 1 call · from the cache", "a subscription plan's $0 is not free");
  assert.equal(costWords("summary", { ...PLAN.methods.summary, cost: 0, listCost: null }), "On your plan · 1 call · from the cache", "…priced or not");
  assert.equal(costWords("summary", { ...PLAN.methods.summary, cost: 0, listCost: 0 }), "Free · 1 call · from the cache", "$0 at list too: free");
  assert.equal(costWords("summary", { ...PLAN.methods.summary, slices: 3, cost: null, fork: false }), "unpriced · 3 calls", "the writer is named in its own section");
  assert.equal(costWords("summary", PLAN.methods.summary, { model: true }), "≈ $0.29 · 1 call · claude-opus-5-5 · from the cache", "an agent's way names it");
  assert.equal(compactionFacts({ detail: { before: 131_000, after: 68_000, exact: false, model: "agent/grok-4.6", how: "slices", calls: 3 } }), " · 131k → ≈68k · grok-4.6, in 3 slices");
  assert.equal(compactionFacts({ detail: { before: 50_000, after: 20_000, exact: true, model: null, how: "local" } }), " · 50k → 20k");
  for (const how of ["agent-fork", "agent"])
    assert.equal(compactionFacts({ detail: { before: 180_000, after: 12_000, exact: false, model: "claude-team/sonnet", how } }), " · 180k → ≈12k · claude-team/sonnet, the agent itself", "a coding agent's own summary (HarnessV3-ACP AC5-4)");
  assert.equal(compactionFacts({}), "");
  // What came back after the summary (HarnessV3-AtHome AH-D9 b): the files shown and the plan; a file only named did not.
  // (fails before: yes — the row's figures said nothing of it)
  const at = (/** @type {any} */ attached) => compactionFacts({ detail: { before: 50_000, after: 20_000, exact: true, attached } });
  assert.equal(at({ shown: 1, named: 0, plan: false }), " · 50k → 20k · 1 file brought back");
  assert.equal(at({ shown: 0, named: 2, plan: true }), " · 50k → 20k · the plan brought back");
  assert.equal(at({ shown: 0, named: 2, plan: false }), " · 50k → 20k", "named only: nothing was brought back");
  for (const m of [...METHODS.map((x) => x.id), "trim"]) assert.match(methodThumb(m), /^<svg viewBox="0 0 34 30"[^>]*>(<rect [^>]*style="fill:var\(--accent\);opacity:[0-9.]+"\/>)+<\/svg>$/, m);
});

test("kit pages: push slides in and focuses back, back returns the focus to the row that opened it, repaint draws the top page again; each swap relayouts", () => {
  let swaps = 0;
  const nav = pages(fakeH, { onSwap: () => swaps++, drawIn: fakeDrawIn });
  let n = 0;
  /** @type {any} */
  let row = null;
  nav.open(() => fakeH("div", {}, `main ${++n}`, (row = fakeH("button", { class: "opener" }, "open"))));
  nav.push(() => fakeH("div", {}, "how", fakeH("button", { class: "inst-back" }, "back")), { returnTo: ".opener" });
  assert.equal(textOf(nav.el), "how|back");
  assert.ok(nav.el.kids[0].classList.contains("inst-page-in-fwd"));
  assert.equal(nav.el.querySelector("inst-back").focused, true, "the pushed page's back button takes the focus");
  nav.back();
  assert.equal(textOf(nav.el), "main 2|open", "the page under it, drawn again");
  assert.ok(nav.el.kids[0].classList.contains("inst-page-in-back"));
  assert.equal(row.focused, true, "the focus goes back to the row that opened the page");
  assert.equal(swaps, 3, "every draw places the popover again");
  nav.back();
  assert.equal(nav.depth(), 1, "the root stays");
  nav.repaint();
  assert.equal(textOf(nav.el), "main 3|open");
});

// HarnessV3-FixRound item 32, decision 24. (fails before: yes — the page only took the undone row away; the row under
// it offered Undo after a reload)
test("an Undo's answer onto the rows: the undone one goes, the one the server names offers Undo, no other does", () => {
  const older = { type: "compaction", id: 3, afterTurn: 2, fromTurn: 1, toTurn: 2, undoable: false };
  const newer = { type: "compaction", id: 4, afterTurn: 3, fromTurn: 1, toTurn: 3, undoable: true };
  const stale = { type: "compaction", id: 1, afterTurn: 1, fromTurn: 1, toTurn: 1, undoable: true };
  const turns = [{ n: 1, boundaries: [], boundariesAfter: [stale] }, { n: 2, boundaries: [], boundariesAfter: [older] }, { n: 3, boundaries: [], boundariesAfter: [newer] }, { n: 4, boundaries: [], boundariesAfter: [] }];
  const changed = afterCompactionUndo(turns, 4, 3);
  assert.deepEqual(changed.map((t) => t.n), [1, 2, 3], "every turn whose rows moved is drawn again, and only those");
  assert.deepEqual(turns.map((t) => t.boundariesAfter.map((b) => [b.id, b.undoable])), [[[1, false]], [[3, true]], [], []]);
  assert.deepEqual(afterCompactionUndo(turns, 3, null).map((t) => t.n), [2]);
  assert.deepEqual(turns.flatMap((t) => t.boundariesAfter.map((b) => [b.id, b.undoable])), [[1, false]], "none left to undo");
  // A row drawn before a turn (`boundaries`) goes the same way.
  const before = [{ n: 5, boundaries: [{ type: "compaction", id: 7, fromTurn: 1, toTurn: 4, undoable: true }], boundariesAfter: [] }];
  assert.deepEqual(afterCompactionUndo(before, 7, null).map((t) => t.n), [5]);
  assert.deepEqual(before[0].boundaries, [], "the undone row is gone from before its turn too");
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /compactionUndone\(chat, id, r\.undoable == null \? null : Number\(r\.undoable\)\);/, "the Undo follows the server's answer (a source contract: the page boots a DOM at import)");
  assert.match(app, /function compactionUndone\(chat, id, next\) \{\s+\(chat\.undoneHeard \|\|= \[\]\)\.push\(\{ at: Date\.now\(\), id, next \}\);\s+\(chat\.undoneIds \|\|= new Set\(\)\)\.add\(Number\(id\)\);\s+const open = chatOf\(state\.currentId\) === chat;\s+for \(const t of afterCompactionUndo\(chat\.turns, id, next\)\) if \(open\) transcript\.drawBoundaries\(t\);/);
});

describe("in a coding agent's session (HarnessV3-ACP AC5-8)", () => {
  /** The compactor's plan in an agent's session: Filament's summary written by a model Filament calls. */
  const AGENT_PLAN = Object.freeze({
    ...PLAN,
    methods: { ...PLAN.methods, summary: { ...PLAN.methods.summary, model: "house-cheap", fork: false, cost: 0.23 } },
    recommended: "model",
    writers: { session: null, side: { ...PLAN.writers.side }, chosen: { model: "house-cheap", fork: false, why: "memory's model (the session's is a coding agent)", cost: 0.23 }, cache: { state: "none" } },
  });
  /** The plan's word on the agent's session: its cache warm, the suggestion Self, its own compaction forked first. @param {any} [more] */
  const said = (more = {}) => ({ chosen: "suggested", way: "self", suggested: true, weighed: true, own: "fork", self: "fork", opens: false, share: null, warmUntil: Date.now() + 180_000, held: 120_000, window: 200_000, estimated: false, unsaid: false, over: false, ...more });
  /** @param {any} [o] */
  const agentWorld = ({ agentSaid = said(), ...o } = {}) => world({ agent: true, preview: { compaction: { ...AGENT_PLAN, agent: agentSaid }, compactions: [] }, ...o });

  test("the way now: the server's, a suggested Self gone cold since is Ours; why, in a few words", () => {
    const now = 1_000_000;
    const a = said({ warmUntil: now + 90_000 });
    assert.equal(wayNow(a, now), "self");
    assert.equal(wayNow(a, now + 90_000), "ours", "its cache gone cold since the figures came");
    assert.equal(wayNow({ ...a, chosen: "self", suggested: false }, now + 90_000), "self", "a Self the session chose stays Self");
    assert.equal(wayReason(a, "self", now), "Suggested: its cache is warm, 1:30 left");
    assert.equal(wayReason(a, "ours", now + 90_000), "Suggested: its cache has gone cold");
    assert.equal(wayReason({ ...a, way: "ours", self: null }, "ours", now), "Suggested: it writes no summary");
    assert.equal(wayReason({ ...a, chosen: "own", own: null }, "self", now), "Its own compaction isn't open now; suggested: its cache is warm, 1:30 left");
    assert.equal(wayReason({ ...a, chosen: "own", way: "own", suggested: false }, "own", now), "", "the way the session chose needs no why");
    assert.equal(wayReason({ ...a, way: "ours", weighed: false }, "ours", now), "Nothing it holds is counted yet");
    assert.equal(wayReason({ ...a, chosen: "ours", way: "ours", suggested: false, weighed: false }, "ours", now), "");
  });

  // (fails before: yes — HarnessV4_Tasks U3-6, UX-9: the suggestion had no word for the agent's own compaction, nothing
  // said a cold cache, and no way said what it reads again)
  test("the suggestion's own compaction, a cold cache, and the ways as the card lists them: what each reads again", () => {
    const now = 1_000_000;
    const a = said({ way: "own", warmUntil: now + 90_000 });
    assert.equal(wayNow(a, now + 90_000), "own", "its own compaction stays the way once the cache is cold");
    assert.equal(wayReason(a, "own", now), "Suggested: its own compaction");
    assert.equal(wayReason({ ...a, chosen: "self", self: null }, "own", now), "It can't write the summary now; suggested: its own compaction");
    assert.deepEqual([isCold(a, now), isCold(a, now + 90_000), isCold({ ...a, weighed: false, warmUntil: 0 }, now), isCold(null, now)], [false, true, false, false]);
    const o = { plan: { ...AGENT_PLAN, agent: a }, agent: true, agentName: "Claude Code" };
    const cold = askChoices({ ...o, now: now + 90_000 });
    // (fails before: yes — the owner's rules of 10-31: the card listed the tail, Least lossy and every method after the
    // agent's own two) An agent's own two, then the side model and the fold: the agent writing it is the same model.
    assert.deepEqual(cold.map((r) => [r.id, r.recommended, r.disabled]), [["way:own", true, false], ["way:self", false, false], ["side", false, false], ["fold", false, false]]);
    assert.deepEqual(cold.slice(0, 2).map((r) => [r.label, r.sub]), [
      ["Claude Code makes room its own way", "Reads 120K again · forked first, so Undo brings its session back"],
      ["Claude Code writes the summary", "Reads 120K again · in a fork, read-only"],
    ]);
    assert.equal(cold[0].tag, "Recommended");
    assert.equal(cold.find((r) => r.id === "side")?.sub, "≈ $0.23 · 1 call · house-cheap", "Filament's copy costs what its writer does, and says who writes");
    assert.deepEqual(cold.filter((c) => c.writes).map((c) => c.id), ["side"], "the agent's own ways write nothing of the card's side model");
    // Warm: nothing is read again worth saying. An estimate is said as one; a way it lacks is off, with why.
    assert.deepEqual(askChoices({ ...o, now }).slice(0, 2).map((r) => r.sub), ["Forked first, so Undo brings its session back", "In a fork, read-only"]);
    const lacks = askChoices({ ...o, plan: { ...AGENT_PLAN, agent: { ...a, own: null, self: "live", estimated: true } }, now: now + 90_000 });
    assert.deepEqual(lacks.slice(0, 2).map((r) => [r.sub, r.disabled]), [[NOT_OFFERED.own, true], ["Reads ≈120K again · in its session, read-only", false]]);
    assert.deepEqual(askChoices({ plan: AGENT_PLAN, agent: false, agentName: "", now }).map((r) => r.id), ["side", "fold", "same"], "Filament's loop: the three kinds alone");
    // The kind chosen is the copy's: the agent's own way it takes now stays first; Filament's copy (Ours) takes the
    // kind chosen.
    assert.deepEqual(askChoices({ ...o, now: now + 90_000, chosen: "fold" }).filter((c) => c.recommended).map((c) => c.id), ["way:own"]);
    const ours = askChoices({ ...o, plan: { ...AGENT_PLAN, agent: { ...a, way: "ours", own: null, self: null } }, now: now + 90_000 });
    assert.deepEqual(ours.filter((c) => c.recommended).map((c) => c.id), ["side"], "Filament's copy: the cache's kind");
    const oursFold = askChoices({ ...o, plan: { ...AGENT_PLAN, agent: { ...a, way: "ours", own: null, self: null } }, now: now + 90_000, chosen: "fold" });
    assert.deepEqual(oursFold.filter((c) => c.recommended).map((c) => c.id), ["fold"], "Filament's copy: the kind chosen");
    // (fails before: yes — the owner's of 11-06) What the agent is given changed: its own compaction keeps the session
    // with the tools it first loaded, so it is not offered; Filament's ways start a fresh one, the instant fold first.
    const changed = askChoices({ ...o, now: now + 90_000, changed: true });
    assert.deepEqual(changed.map((c) => [c.id, c.recommended]), [["way:self", false], ["fold", true], ["side", false]]);
  });

  // (fails before: yes — with the Compaction pill gone nothing said why Compact now takes the way it takes, nor what it leaves)
  test("the way row: the way Compact now takes, why and what it leaves; Compact now… brings the card up", async () => {
    const w = agentWorld({ agentName: "Claude Code" });
    const el = w.how();
    await settle();
    assert.ok(textOf(rowOf(el, "line")).includes("170K · 85%"), "its line, on the face");
    const text = textOf(rowOf(el, "way"));
    assert.ok(text.startsWith("The way|the card's first choice|Suggested · Claude Code writes a summary now"), `its way, on the face: ${text}`);
    // The row names the way the suggestion takes; the line under it says why and what it leaves, not "Suggested" again
    // (V4-D217).
    assert.match(text, /\|↳ Its cache is warm, [23]:\d\d left · in a fork, read-only$/);
    button(w.pop(), "Compact now").dispatch("click");
    assert.equal(w.did.at(-1), "summon", "the card, its way chosen first");
    // Its cache gone cold: Filament's methods on its copy.
    const cold = agentWorld({ agentSaid: said({ warmUntil: Date.now() - 1 }) });
    const e2 = advanced(cold.how());
    await settle();
    const t2 = textOf(rowOf(e2, "way"));
    assert.ok(t2.includes("Suggested · Filament's copy now"), t2);
    assert.ok(t2.endsWith("|↳ Its cache has gone cold · One summary · ≈ $0.23 · 1 call · house-cheap"), t2);
    // (fails before: yes — V4-D217: "Suggested · Claude Code's own compaction now" and under it "Suggested: its own
    // compaction · forked first…", the way named twice) The suggestion takes its own compaction: the line says what it does.
    const ownNow = agentWorld({ agentName: "Claude Code", agentSaid: said({ way: "own" }) });
    const e7 = advanced(ownNow.how());
    await settle();
    const t7 = textOf(rowOf(e7, "way"));
    assert.ok(t7.endsWith("Suggested · Claude Code's own compaction now|↳ Forked first, so Undo brings its session back"), t7);
    assert.ok(!t7.includes("its own compaction ·"), t7);
    // Its own compaction, chosen: what it leaves is its own to decide.
    const own = agentWorld({ flat: { "context.compaction.agent": "own" }, agentSaid: said({ chosen: "own", way: "own", suggested: false }) });
    const e3 = advanced(own.how());
    await settle();
    const t3 = textOf(rowOf(e3, "way"));
    assert.ok(t3.includes("The agent's own compaction") && t3.endsWith("|↳ Forked first, so Undo brings its session back"), t3);
    assert.ok(!t3.includes("after"), "no figure for what the agent leaves by itself");
    // (fails before: yes — the Hunter's of 11-01 on ed10cb730: a session that opens first was said to be live; and on
    // 58c3ea758: a fork of one that opens first said nothing of its opening) Its own compaction in its live session, or
    // after its session opening first, as the card's choice says.
    const ownWays = /** @type {const} */ ([
      ["live", false, "In its live session"],
      ["live", true, "Opens its session first · in its session"],
      ["fork", true, "Opens its session first · forked first, so Undo brings its session back"],
    ]);
    for (const [kind, opens, words] of ownWays) {
      const live = agentWorld({ flat: { "context.compaction.agent": "own" }, agentSaid: said({ chosen: "own", way: "own", suggested: false, own: kind, opens }) });
      const e = advanced(live.how());
      await settle();
      const t = textOf(rowOf(e, "way"));
      assert.ok(t.endsWith(`|↳ ${words}`), t);
      const card = askChoices({ plan: { ...AGENT_PLAN, agent: said({ own: kind, opens }) }, agent: true, agentName: "Claude Code", now: Date.now() });
      assert.equal(card[0].sub, words, "the card's choice says the same");
    }
    // (fails before: yes — the Hunter's of 11-01 on 58c3ea758: the summary it writes said nothing of its session
    // opening first) The summary it writes, after its session opening first.
    const selfOpens = agentWorld({ agentName: "Claude Code", agentSaid: said({ opens: true }) });
    const e8 = advanced(selfOpens.how());
    await settle();
    const selfRow = textOf(rowOf(e8, "way"));
    assert.match(selfRow, /\|↳ Its cache is warm, [23]:\d\d left · opens its session first · in a fork, read-only$/);
    const selfCard = askChoices({ plan: { ...AGENT_PLAN, agent: said({ opens: true }) }, agent: true, agentName: "Claude Code", now: Date.now() }).find((c) => c.id === "way:self");
    assert.equal(selfRow.replace(/^.*\|↳ Its cache is warm, [23]:\d\d left · /, ""), String(selfCard?.sub).replace(/^./, (c) => c.toLowerCase()), "the card's choice says the same");
    // Nothing counted yet: Filament's methods until there is a figure.
    const fresh = agentWorld({ facts: null, agentSaid: said({ way: "ours", weighed: false, own: null, self: null, opens: false, share: null, warmUntil: 0, held: null, window: null }) });
    const e4 = advanced(fresh.how());
    await settle();
    assert.ok(textOf(rowOf(e4, "way")).includes("|↳ Nothing it holds is counted yet · One summary · "), textOf(rowOf(e4, "way")));
    // (fails before: yes — the line quoted Filament's "no model to summarize with" under a summary the agent writes)
    // Filament has no model to write a summary with: no obstacle to the agent's own; nothing to summarize is one.
    const noModel = "no model to summarize with: name one in context.compaction.model (a coding agent's model writes it too, in a session of its own)";
    /** @param {any} summary */
    const withSummary = async (summary) => {
      const x = world({ agent: true, preview: { compaction: { ...AGENT_PLAN, methods: { ...AGENT_PLAN.methods, summary: { ...AGENT_PLAN.methods.summary, possible: false, reaches: false, ...summary } }, agent: said() }, compactions: [] } });
      const e = advanced(x.how());
      await settle();
      return textOf(rowOf(e, "way"));
    };
    const t5 = await withSummary({ model: null, cost: null, why: noModel, status: 400 });
    assert.match(t5, /\|↳ Its cache is warm, [23]:\d\d left · in a fork, read-only$/);
    assert.ok(!t5.includes("no model"), t5);
    const t6 = await withSummary({ why: "no finished turn to summarize" });
    assert.match(t6, /\|↳ Its cache is warm, [23]:\d\d left · no finished turn to summarize$/);
    // Before the plan's word on the session: no line of why.
    const early = agentWorld();
    early.ctx.preview = () => new Promise(() => {});
    const before = textOf(rowOf(advanced(early.how()), "way"));
    assert.ok(before.startsWith("The way") && !/↳ (Suggested|Its cache)/.test(before), `nothing claimed before the figures: ${before}`);
  });

  // (fails before: no — U5 phase 3, V9: Another way left the popover; the card lists the agent's ways and Filament's)
  test("the popover in a coding agent's chat: Compact now… brings the card up, no list of its own", async () => {
    const w = agentWorld();
    const body = w.pop();
    await settle();
    assert.equal(button(body, "Another way"), undefined);
    assert.equal(find(body, "inst-other"), null);
    assert.equal(textOf(body).includes("Dry run"), false, "the dry run weighs Filament's composition, which an agent never reads");
    button(body, "Compact now…").dispatch("click");
    assert.deepEqual(w.did, ["closed", "summon"]);
  });

  // (fails before: yes — the review of 10-31: Fold now in a coding agent's chat folds Filament's copy, and said nothing
  // of the fresh session the agent then starts from it)
  test("the popover's instant fold in a coding agent's chat: Filament's copy folds, and the agent starts a fresh session from it", async () => {
    const w = agentWorld({ agentName: "Claude Code" });
    const body = w.pop();
    await settle();
    assert.equal(textOf(find(body, "inst-fold-offer")), "Instant fold: leaves 18K of the earlier turns, no model call — Claude Code starts a fresh session from it|Fold now");
    assert.match(String(button(body, "Fold now").attrs.title), /^Fold Filament's copy of the chat now: .*Claude Code's next turn starts a fresh session from it/);
    button(body, "Fold now").dispatch("click");
    assert.deepEqual(w.did.slice(-2), ["closed", "fold now"]);
  });

  test("the ways' list: the session's checked and the one running marked Now; choosing writes context.compaction.agent; Filament's methods and their writer behind Filament's copy", async () => {
    const w = agentWorld({ agentName: "Codex" });
    const el = w.how();
    await settle();
    assert.equal(findAll(el, "inst-method-row").length, 0, "Filament's methods wait under Advanced");
    const row = opened(advanced(el), "way");
    for (const bit of ["Suggested", "Codex's own compaction", "Codex writes a summary", "Filament's copy"]) assert.ok(textOf(row).includes(bit), `${bit} in ${textOf(row)}`);
    const ways = findAll(row, "inst-way-row");
    assert.deepEqual(ways.map((r) => r.attrs["aria-checked"]), ["true", "false", "false", "false"]);
    assert.deepEqual(ways.map((r) => textOf(r).endsWith("|Now")), [false, false, true, false], "Codex writes it now");
    ways[1].dispatch("click");
    assert.equal(w.did.at(-1), 'write {"patch":{"context":{"compaction":{"agent":"own"}}}}');
    // Under their own heading in Advanced (U11; their own disclosure until then).
    const copy = find(el, "inst-how-advanced");
    for (const bit of ["Compact on Filament's copy instead", "Written by", "house-cheap", "chip"]) assert.ok(textOf(copy).includes(bit), `${bit} in ${textOf(copy)}`);
    assert.equal(button(el, "Compact on Filament's copy instead"), undefined, "a heading, no button to open");
    assert.ok(!textOf(copy).includes("Cheaper"), "no writer to choose: the agent writing it is a way of its own");
    assert.equal(findAll(copy, "inst-method-row").length, 2, "Filament's methods, for the copy a fresh session starts from");
    // A way it lacks now stays choosable: the suggestion stands in until it has it.
    const lacks = agentWorld({ agentSaid: said({ own: null }) });
    const e3 = advanced(lacks.how());
    await settle();
    const ownRow = findAll(opened(e3, "way"), "inst-way-row")[1];
    assert.ok(textOf(ownRow).includes("Not offered: no compaction of its own here, or no session of this chat to go on in; the suggestion stands in"), textOf(ownRow));
    ownRow.dispatch("click");
    assert.equal(lacks.did.at(-1), 'write {"patch":{"context":{"compaction":{"agent":"own"}}}}');
  });
});
