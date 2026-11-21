// HarnessV3 Compaction methods (the vault's HarnessV3-Compaction.md §5), as the owner's rules of 10-31 leave them: the
// compactor — the three kinds (the same model's summary, a side model's, an instant fold), weighed before anything is
// written, the writer and its fork of the warm cache, how a writer reads the turns (whole, folded first, slices last);
// the compaction marks the composer honors in every form, Whole included; the archive's row with a method and no text.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompactor, chooseWriter, cheaperOf, pricedOf, compactionSettingsOf, summaryEstimate, filler, SUMMARY_ESTIMATE_PAST, writerWindow, roundsForkInstruction, ASSUMED_WINDOW, FORK_SUMMARY_INSTRUCTION, FORK_MIN_TOKENS, FORK_INSTRUCTION_TOKENS } from "../src/app/sessions/compactor.js";
import { compose } from "../src/app/sessions/compose.js";
import { DEFAULT_OUTPUT_TOKENS, fittedMaxTokens, replyHeadroom } from "../src/core/tokens.js";
import { shapePlan, compactedShapeOf } from "../src/app/sessions/shapes.js";
import { compactionHead, writtenTokens, SUMMARY_ESTIMATE_CEILING } from "../src/app/sessions/compaction.js";
import { resolveSettings, KNOBS } from "../src/services/session-settings.js";
import { Archive } from "../src/services/memory/archive.js";
import { compactionWords } from "../src/ui/harness/lib/labels.js";
import { joinSlices } from "../src/core/trim.js";
import { estimateTokens } from "../src/core/tokens.js";
import { goThrough } from "../src/app/agent/still-open.js";

/** A completed turn with one tool round: read a file, answer. `big` pads the result, `finalBig` the answer. */
const turn = (n, { big = 6000, finalBig = 0, meta = {} } = {}) => ({
  turnId: 100 + n,
  n,
  user: { role: "user", content: [{ type: "text", text: `turn ${n}: look at f${n}.txt` }] },
  work: [
    { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: `t${n}`, name: "read", input: { path: `f${n}.txt` } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}`, content: `contents of file ${n}` + (big ? " " + "x".repeat(big) : "") }] },
  ],
  final: { role: "assistant", content: [{ type: "text", text: `Turn ${n} done: f${n}.txt read.` + (finalBig ? " " + "y".repeat(finalBig) : "") }] },
  meta: { ...meta },
});
const turnsOf = (count, o = {}) => Array.from({ length: count }, (_, i) => turn(i + 1, o));
const NEW = { role: "user", content: [{ type: "text", text: "next" }] };
const settingsFor = (session) => resolveSettings({ session }).effective;
const CHAIN = { id: "c1", key: "n:c1" };
/** The composer as the service binds it: the request each way of making room would leave. */
const measureFor = (doc, window) => async ({ turns, compactions }) => {
  const c = await compose({ turns, compactions, settings: doc, newUser: NEW, model: "m", window });
  return { sent: c.report.sentTokens, earlier: c.report.earlierTokens, perTurn: c.report.turns.map((t) => ({ n: t.n, tokens: t.tokens })) };
};

/**
 * The compactor over an in-memory archive and a model that answers from the test. `turns` are mutated in place by a
 * fold compaction's marks, as the archive's rows would be. `agent`: claude/* reaches a coding agent.
 */
function rig({ turns = [], answer = async () => "THE SUMMARY", summarizer = "house-cheap", sliceConfig = {}, sliceSummarize = null, pricing = {}, subagents = null, compacted = null, agent = false, speedOf = null, timeOf = null, stillOpen = null } = {}) {
  const calls = [];
  const rows = [];
  const recorded = [];
  const logs = [];
  const archive = {
    addCompaction(chainId, o) {
      const id = rows.length + 1;
      rows.push({ id, chainId, ...o });
      return { id, hash: o.summaryText == null ? null : "h" };
    },
    compactTurns(chainId, { turnIds, shape, kind, method, fromTurn, toTurn, window }) {
      const { id } = this.addCompaction(chainId, { fromTurn, toTurn, summaryText: null, kind, window, method });
      for (const t of turns) if (turnIds.includes(t.turnId)) t.meta = { ...(t.meta || {}), compacted: { shape, id, at: 1 } };
      return { id, marked: turnIds.length };
    },
    turnBodies: () => turns,
  };
  const memory = {
    archive,
    callModel: async (a) => {
      calls.push(a);
      return answer(a);
    },
    summarizerModel: () => summarizer,
    sliceConfig: () => sliceConfig,
    ...(sliceSummarize ? { sliceSummarize } : {}),
    ...(compacted ? { compacted } : {}),
  };
  // Each priced model goes to one upstream whose card prices it, as an operator would set it.
  const config = {
    get: () => ({
      rules: {},
      routes: [...Object.keys(pricing).map((match) => ({ match, upstream: "u" })), ...(agent ? [{ match: "claude/*", upstream: "claude", upstreamModel: "{1}" }] : [])],
      upstreams: [{ id: "u", type: "openai-compatible", baseUrl: "http://u", pricing }, ...(agent ? [{ id: "claude", type: "acp", acp: { command: "claude-agent-acp" } }] : [])],
    }),
  };
  const compactor = createCompactor({ memory, config, ops: { record: (...a) => recorded.push(a) }, log: (_l, m) => logs.push(m), subagents, speedOf, timeOf, stillOpen, now: () => 1000 });
  return { compactor, calls, rows, recorded, logs };
}
/** One run of the compactor at the manual door, the session's own document and window. */
const runWith = (r, { doc, turns, compactions = [], window = 20000, method = null, sessionModel = "m", trigger = "manual", guard = null, signal = null, onStep = null }) =>
  r.compactor.run({ chain: CHAIN, doc, turns, compactions, sessionModel, window, measure: measureFor(doc, window), trigger, method, guard, signal, onStep });

// (the guard Phase 1's M6 checked: since Phase 2 every caller hands a part-of-the-window summary a writer that cannot
// fork, so the guard is out of reach through them — it is writeSummary's own rule, tested on its own)
test("writeSummary forks the warm cache only when the summary stands for the whole window, whatever writer it is handed", async () => {
  /** @type {any[]} */
  const forks = [];
  const subagents = { forkCall: async (/** @type {any[]} */ ...a) => (forks.push(a), { ok: true, text: "FORKED" }) };
  const r = rig({ subagents });
  const list = turnsOf(3);
  const writer = { model: "m", fork: true, why: "", cost: null };
  const part = await r.compactor.writeSummary({ chain: CHAIN, list, lead: null, whole: false, writer });
  assert.equal(part.how, "call");
  assert.equal(forks.length, 0, "a summary of part of the window never forks: the cache holds the whole of it");
  const whole = await r.compactor.writeSummary({ chain: CHAIN, list, lead: null, whole: true, writer });
  assert.equal(whole.how, "fork");
  assert.equal(forks.length, 1);
});

// (fails before: yes — a compaction said nothing of where it was, and its calls named no job, so its progress could not
// be told from the session's other calls; HarnessV3-FailurePoints §5.1 item 3)
test("each writer says its step, and its calls carry the compaction's job", async () => {
  /** @type {any[]} */
  const steps = [];
  /** @type {any[]} */
  const forks = [];
  /** @type {any[]} */
  const sliced = [];
  const onStep = (/** @type {any} */ s) => steps.push(s);
  const subagents = { forkCall: async (/** @type {any[]} */ ...a) => (forks.push(a), { ok: true, text: "FORKED" }) };
  const r = rig({
    subagents,
    sliceConfig: { maxSliceTokens: 2000 },
    sliceSummarize: async (/** @type {any} */ o) => {
      sliced.push(o);
      o.onProgress({ step: "trim", message: "summarizing slice 1", percent: 40 });
      return { text: "SLICED", calls: 1 };
    },
  });
  const writer = { model: "m", fork: true, why: "", cost: null };
  await r.compactor.writeSummary({ chain: CHAIN, list: turnsOf(3), lead: null, whole: true, writer, job: "job-1", onStep });
  assert.equal(forks[0][2].job, "job-1", "the fork");
  await r.compactor.writeSummary({ chain: CHAIN, list: turnsOf(3, { big: 400 }), lead: null, whole: false, writer, job: "job-1", onStep });
  assert.equal(r.calls.at(-1).jobId, "job-1", "the one call");
  await r.compactor.writeSummary({ chain: CHAIN, list: turnsOf(4, { finalBig: 3800 }), lead: null, whole: false, writer, job: "job-1", onStep });
  assert.equal(sliced[0].jobId, "job-1", "the slice pass");
  assert.deepEqual(steps, [
    { message: "a fork of the session's own request writes the summary (m)" },
    { message: "m writes the summary in one call" },
    { message: "summarizing slice 1", percent: 40, planned: 3 },
  ]);
  // A run hands its job and its sink to the writer.
  steps.length = 0;
  const doc = settingsFor({});
  const turns = turnsOf(3);
  const out = await r.compactor.run({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000), trigger: "manual", method: "summary", job: "job-2", onStep });
  assert.equal(out.ok, true, out.ok ? "" : out.error);
  assert.ok(steps.length > 0 && [...forks.slice(1).map((f) => f[2].job), ...r.calls.slice(1).map((c) => c.jobId)].includes("job-2"), "the run's writer carried its job");
});

// ---- the marks: compaction's shapes ---------------------------------------------------------------------------------

// (fails before: yes — shapePlan had no marks; plain kept every turn raw, so a fold compaction could never make room there)
test("shapePlan: a compaction mark holds under Whole; in the other forms it is a floor", () => {
  assert.deepEqual(shapePlan(3, "plain", ["fold", null, null]), ["fold", "raw", "raw"], "Whole renders the mark");
  assert.deepEqual(shapePlan(4, "fold+2", [null, null, "fold", null]), ["fold", "fold", "fold", "raw"], "a mark below the plan takes the turn down");
  assert.deepEqual(shapePlan(3, "fold", ["raw", null, null]), ["fold", "fold", "fold"], "a mark above the plan holds nothing up");
  assert.equal(compactedShapeOf({ meta: { compacted: { shape: "fold", id: 1 } } }), "fold");
  assert.equal(compactedShapeOf({ meta: {} }), null, "no mark");
});

// (fails before: yes — a mark of a shape no turn takes any more read as no mark, so the turns a digest compaction had
// marked `summary` went whole again under Whole, every tool result back in the request)
test("a compaction's mark of a shape no turn takes any more folds the turn: it was compacted, and it never goes whole again", async () => {
  assert.deepEqual(shapePlan(3, "plain", ["summary", "summary", null]), ["fold", "fold", "raw"]);
  assert.equal(compactedShapeOf({ meta: { compacted: { shape: "summary", id: 4 } } }), "fold");
  const turns = turnsOf(3);
  const marked = turns.map((t, i) => (i < 2 ? { ...t, meta: { ...t.meta, compacted: { shape: "summary", id: 4, at: 1 } } } : t));
  const c = await compose({ turns: marked, settings: settingsFor({}), newUser: NEW, model: "m" });
  assert.deepEqual(c.report.turns.map((t) => [t.shape, t.compacted]), [["fold", true], ["fold", true], ["raw", false]]);
});

// (fails before: yes — compose read no marks, and the freeze recorded whatever rendered)
test("compose: marked turns render at their mark under Whole and are reported as compacted; a form folds what is not marked", async () => {
  const marked = (t, shape) => ({ ...t, meta: { ...t.meta, compacted: { shape, id: 9, at: 1 } } });
  const turns = turnsOf(3);
  const plain = await compose({ turns: [marked(turns[0], "fold"), marked(turns[1], "fold"), turns[2]], settings: settingsFor({}), newUser: NEW, model: "m" });
  assert.deepEqual(plain.report.turns.map((t) => [t.shape, t.compacted]), [["fold", true], ["fold", true], ["raw", false]]);
  const whole = await compose({ turns, settings: settingsFor({}), newUser: NEW, model: "m" });
  assert.ok(plain.report.sentTokens < whole.report.sentTokens / 2, "the folds made room under Whole");
  // A fresh agent session's Folded, newest 2 whole, with a fold mark on a turn it keeps whole: rendered folded.
  const f2 = await compose({ turns: [turns[0], marked(turns[1], "fold"), turns[2]], settings: settingsFor({}), form: "fold+2", newUser: NEW, model: "m" });
  assert.deepEqual(f2.report.turns.map((t) => [t.shape, t.compacted]), [["fold", false], ["fold", true], ["raw", false]]);
});

// ---- the plan: every way weighed, nothing written -----------------------------------------------------------------

test("plan: fold and summary weighed by composing each; keepWhole keeps the newest; the fold says what it leaves of the earlier turns", async () => {
  const turns = turnsOf(5);
  const doc = settingsFor({});
  const r = rig({ turns });
  const p = await r.compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000) });
  assert.equal(p.method, "summary", "the default method is one summary");
  assert.deepEqual([p.keepWhole, p.instantTokens], [1, 20000]);
  assert.equal(p.methods.fold.turns, 4, "turns 1–4: turn 5 kept whole");
  assert.ok(p.methods.fold.after < p.now && p.methods.fold.possible, `${p.methods.fold.after} of ${p.now}`);
  assert.equal(p.methods.fold.calls, 0);
  const folded = await measureFor(doc, 20000)({ turns: turns.map((t) => (t.n < 5 ? { ...t, meta: { compacted: { shape: "fold", id: 0, at: 0 } } } : t)), compactions: [] });
  assert.equal(p.methods.fold.earlier, folded.earlier, "what the fold leaves of the earlier turns, as the composer weighs them");
  assert.ok(p.methods.fold.earlier < p.methods.fold.after, "the earlier turns alone: no system prompt, no new message");
  assert.equal(p.methods.summary.headTurns, 5); assert.equal(p.methods.summary.model, "m", "no writer chosen: the session's model");
  assert.deepEqual(Object.keys(p.methods), ["fold", "summary"], "no tail, no least lossy, no newest");
  assert.equal(r.calls.length, 0, "a plan calls no model");
  assert.equal(r.rows.length, 0, "and writes nothing");
  assert.equal(turns[1].meta.compacted, undefined, "the turns it weighed are untouched");
});

// (fails before: yes — the plan had no line, no settings, no summary size or slice budget, no writer windows, and a
// warm cache too full to fork was quoted at the fork's price)
test("plan, the preview's figures: the line and the settings, the summary's size and slice budget, each writer's window, and prices for what would really run", async () => {
  const turns = turnsOf(4, { finalBig: 400 });
  const doc = settingsFor({ context: { compaction: { writer: "model", thresholdPercent: 80 } } });
  const pricing = { m: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, "house-cheap": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } };
  const warm = (tokens) => ({ cacheOf: () => ({ state: "warm", leftMs: 120_000, tokens, model: "m", thinking: null }), forkCall: async () => null });
  const planWith = (sub, d = doc) => rig({ turns, pricing, subagents: sub }).compactor.plan({ chain: CHAIN, doc: d, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(d, 20000) });
  const p = await planWith(warm(2000));
  assert.deepEqual([p.line, p.mode, p.method, p.writer], [16000, "ask", "summary", "model"]);
  assert.ok(p.methods.summary.summaryTokens >= 1000, "a summary's size, ≈ (6% of what it reads, at least 1,000)");
  assert.ok(p.methods.summary.sliceBudget > 0 && p.methods.summary.slices === 1, "one call fits the writer's slice budget");
  assert.equal(p.methods.summary.model, "house-cheap", "writer model: memory's model, none named");
  assert.deepEqual([p.writers.side.model, p.writers.side.window, p.writers.side.windowSource], ["house-cheap", ASSUMED_WINDOW, "assumed"], "nobody states the side model's window: 128K assumed, and said");
  assert.equal(p.writers.session.window, 20000);
  // Metered (Providers P4): what each pays is its list price, said beside it.
  assert.equal(p.methods.summary.listCost, p.methods.summary.cost);
  assert.deepEqual([p.methods.fold.cost, p.methods.fold.listCost], [0, 0], "a fold is free at any price");
  assert.deepEqual([p.writers.session.listCost, p.writers.side.listCost], [p.writers.session.cost, p.writers.side.cost]);
  assert.equal(p.writers.side.cost, Math.round(((p.writers.side.transcriptTokens * 1 + writtenTokens(p.writers.side.summaryTokens) * 5) / 1e6) * 1e6) / 1e6, "the side model is priced as the transcript's plain input");
  // Warm with room: the same model can fork, and is priced as a cache read.
  assert.ok(p.writers.cache.forkRoom >= FORK_MIN_TOKENS, `room for a summary: ${p.writers.cache.forkRoom}`);
  assert.deepEqual([p.writers.session.fork, p.writers.session.reads], [true, "fork"]);
  assert.equal(p.writers.session.cost, Math.round(((2000 * 0.5 + FORK_INSTRUCTION_TOKENS * 6.25 + writtenTokens(p.writers.session.summaryTokens) * 25) / 1e6) * 1e6) / 1e6, "the kept conversation read from the cache, the instruction written, the summary and its notes out");
  assert.deepEqual([p.methods.fold.exact, p.methods.summary.exact], [true, false], "what is composed as it would be, and what is weighed with a stand-in (≈)");
  // Warm but full: the kept request leaves no summary's room under the window — no fork, priced as the transcript call.
  const full = await planWith(warm(19_000));
  assert.equal(full.writers.cache.state, "warm");
  assert.equal(full.writers.cache.forkRoom, null, "too full to fork");
  assert.deepEqual([full.writers.session.fork, full.writers.session.reads], [false, "whole"]);
  // Room for a short summary, but not for the notes written before it (AH-D9 a): no fork. (fails before: yes — 2,048
  // tokens of room was enough)
  const tight = await planWith(warm(2000 + p.writers.cache.forkRoom - 3000));
  assert.equal(tight.writers.cache.forkRoom, null, "3,000 tokens of room: under a short summary and its notes");
  // Room under the window, but not above the kept thinking budget: the fork would have to change it and miss the cache.
  const thinking = await planWith({ cacheOf: () => ({ state: "warm", leftMs: 120_000, tokens: 2000, model: "m", thinking: 17_000 }), forkCall: async () => null });
  assert.equal(thinking.writers.cache.forkRoom, null);
  assert.equal(thinking.writers.session.fork, false);
  // (fails before: yes — the preview held the fork to the kept request's max_tokens, or to nothing: a fork is Filament's
  // own call and asks for the most the model can write, as forkCall does; HarnessV3-FailurePoints §13)
  const roomy = await rig({ turns, pricing, subagents: warm(2000) }).compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 1_000_000, measure: measureFor(doc, 1_000_000) });
  assert.equal(roomy.writers.cache.forkRoom, DEFAULT_OUTPUT_TOKENS, "a roomy window: the most the model can write (no ceiling stated here)");
});

// (fails before: yes — marking turns the strategy already folds was "possible" and wrote a compaction that freed nothing)
test("plan: a mark that renders no smaller than the turns already go frees nothing, and says so", async () => {
  // Turns of words alone: a fold of one is its own words.
  const turns = turnsOf(4).map((t) => ({ ...t, work: [] }));
  const doc = settingsFor({ context: { compaction: { keepWhole: 2 } } });
  const r = rig({ turns });
  const p = await r.compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000) });
  assert.equal(p.methods.fold.turns, 2, "turns 1–2 would be marked…");
  assert.equal(p.methods.fold.possible, false, "…but a turn of words alone folds to the same words");
  assert.match(p.methods.fold.why, /folding frees nothing/);
  const out = await runWith(r, { doc, turns, method: "fold" });
  assert.deepEqual({ ok: out.ok, status: out.status }, { ok: false, status: 409 });
  assert.equal(r.rows.length, 0, "nothing written");
});

// ---- the local methods ----------------------------------------------------------------------------------------------

test("run fold: the older turns marked fold in one row with no text; no model; the next request composes them folded", async () => {
  const turns = turnsOf(4);
  const doc = settingsFor({});
  const r = rig({ turns });
  const before = (await measureFor(doc, 20000)({ turns, compactions: [] })).sent;
  const out = await runWith(r, { doc, turns, method: "fold", trigger: "line" });
  assert.equal(out.ok, true);
  assert.deepEqual({ method: out.method, kind: out.kind, fromTurn: out.fromTurn, toTurn: out.toTurn, chars: out.chars, how: out.how }, { method: "fold", kind: "plain", fromTurn: 1, toTurn: 3, chars: 0, how: "local" });
  assert.equal(r.calls.length, 0, "a fold calls no model");
  assert.deepEqual(r.rows.map((x) => ({ summaryText: x.summaryText, method: x.method, kind: x.kind })), [{ summaryText: null, method: "fold", kind: "plain" }]);
  assert.deepEqual(turns.map((t) => compactedShapeOf(t)), ["fold", "fold", "fold", null], "the newest turn kept whole");
  const after = (await measureFor(doc, 20000)({ turns, compactions: [] })).sent;
  assert.ok(after < before / 2, `${before} → ${after}`);
  assert.equal(out.after, after, "the preview's figure is the composition's own");
  assert.match(out.note, /turns 1–3 folded at the compaction line/);
  assert.equal(r.recorded[0][0], "compaction");
  // A second fold has nothing left to do.
  const again = await runWith(r, { doc, turns, method: "fold" });
  assert.deepEqual({ ok: again.ok, status: again.status }, { ok: false, status: 409 });
  assert.match(again.error, /already folded or kept whole/);
});

// ---- the summaries: who writes them, and how ------------------------------------------------------------------------

// (fails before: yes — a summary row carried the summary alone, and the preview weighed nothing after it)
test("after a summary the files its turns used come back as they are on disk, less what kept turns show; the preview weighs them (HarnessV3-AtHome AH-D9 b)", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-compactor-back-"));
  const empty = mkdtempSync(join(tmpdir(), "filament-compactor-empty-"));
  try {
    for (const n of [1, 2, 3, 4]) writeFileSync(join(root, `f${n}.txt`), `file ${n} as it is now\n`);
    const doc = settingsFor({});
    const go = (/** @type {any[]} */ turns, /** @type {string} */ method, /** @type {string} */ where) => {
      const r = rig({ turns });
      return r.compactor.run({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 200_000, measure: measureFor(doc, 200_000), trigger: "manual", method, root: where }).then((out) => ({ out, r }));
    };
    const s = await go(turnsOf(4), "summary", root);
    assert.equal(s.out.ok, true, s.out.error);
    const back = s.r.rows[0].attached;
    assert.deepEqual(back.files.map((/** @type {any} */ f) => f.path), ["f4.txt", "f3.txt", "f2.txt", "f1.txt"], "newest first");
    assert.ok(back.text.includes('<file path="f4.txt">\n     1\tfile 4 as it is now\n</file>'), back.text);
    const turns = turnsOf(4);
    // Nothing on disk to bring back: no file in the row's block, its last reply alone.
    const none = await go(turnsOf(4), "summary", empty);
    assert.deepEqual(none.r.rows[0].attached.files, []);
    assert.ok(!none.r.rows[0].attached.text.includes("<file"), none.r.rows[0].attached.text);
    // The preview weighs the block the summary would bring back.
    const weigh = (/** @type {string} */ where) => rig({ turns }).compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 200_000, measure: measureFor(doc, 200_000), root: where });
    const [withBack, without] = [await weigh(root), await weigh(empty)];
    assert.ok(withBack.methods.summary.after > without.methods.summary.after, `${withBack.methods.summary.after} > ${without.methods.summary.after}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

// (fails before: yes — the owner's plan of 11-02, Phase 4: a summary kept what the conversation said of the dev server
// its agent had started, or left it out, and the agent after it started it again)
test("after a summary what is still open in the chat comes back last, as it stood when the summary was written; nothing open, no block", async () => {
  const doc = settingsFor({});
  const line = "- background command bg_k2: `npm run dev` in /p, running for 12 min";
  /** @type {string[]} */
  const asked = [];
  /** @type {string[]} */
  const told = [];
  const go = async (/** @type {string[]} */ open) => {
    const turns = turnsOf(4);
    const r = rig({ turns, stillOpen: { lines: (/** @type {string} */ chainId) => (asked.push(chainId), open), told: (/** @type {string} */ chainId) => void told.push(chainId), untold: () => assert.fail("no own compaction here") } });
    const out = await r.compactor.run({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 200_000, measure: measureFor(doc, 200_000), trigger: "manual", method: "summary", root: "" });
    assert.equal(out.ok, true, out.error);
    return r.rows[0].attached;
  };
  const back = await go([line]);
  // The row keeps no word of filament_recall: the composer says it to a reader that has it (the owner's of 11-09, D6).
  assert.equal(back.text, `[Filament brought these back after the summary: what was still open as the summary was written, and your reply that ended turn 4, which the person's message after the summary answers. What was open still is unless a later message says it ended: read a command's output or stop it by its id rather than starting it again. ${goThrough("what was open")}]\n\n<open>\n${line}\n</open>\n\n<last-reply turn="4">\nTurn 4 done: f4.txt read.\n</last-reply>`);
  assert.ok(asked.every((c) => c === "c1") && asked.length > 0, "the chat's own");
  // (fails before: yes — the owner's plan of 11-02, Phase 4b: nothing kept that the chat's agent heard the list, so a
  // turn's start could not tell what changed since)
  assert.deepEqual(told, ["c1"], "its main agent heard the list once the summary landed");
  assert.ok(!(await go([])).text.includes("<open>"), "nothing open: no list");
  assert.deepEqual(told, ["c1", "c1"], "a summary with nothing open: the agent heard that too");
});

// (fails before: yes — the owner's plan of 11-02, Phase 4b: the agent compacting its own session on request said nothing
// of what was still open, and nothing after it did)
test("the agent's own compaction of its session: its row once the agent says it compacted, and its next turn's first prompt says what is still open; one that failed, nothing", async () => {
  const turns = turnsOf(3);
  /** @type {string[]} */
  const untold = [];
  const r = rig({ turns, stillOpen: { lines: () => [], told: () => assert.fail("no summary of Filament's here"), untold: (/** @type {string} */ chainId) => void untold.push(chainId) } });
  const out = await r.compactor.own({ chain: CHAIN, turns, compactions: [], model: "claude/sonnet", trigger: "manual", fork: false, agent: async ({ record }) => (record({ summary: "MINE", tokensBefore: 900, tokensAfter: 100, ms: 5, forked: false, instructed: true }), { summary: "MINE", tokensBefore: 900, tokensAfter: 100, ms: 5, forked: false, instructed: true }) });
  assert.equal(out.ok, true, /** @type {any} */ (out).error);
  assert.deepEqual(untold, ["c1"]);
  const failed = await r.compactor.own({ chain: CHAIN, turns: turnsOf(4), compactions: [], model: "claude/sonnet", trigger: "manual", fork: false, agent: async () => { throw new Error("no session"); } });
  assert.equal(failed.ok, false);
  assert.deepEqual(untold, ["c1"], "an own compaction that never happened tells nothing");
});

// (fails before: yes — each cut the plan weighed read back every file its turns used again: a long chat's files, most of
// them since gone, took the plan over a minute)
test("the plan reads back each file its turns used once; the summary, once written, reads them again", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-compactor-once-"));
  /** Twelve turns, each read three files since deleted. */
  const turns = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const paths = [`gone-${n}-a.txt`, `gone-${n}-b.txt`, `gone-${n}-c.txt`];
    return {
      ...turn(n, { big: 0 }),
      work: paths.flatMap((p, k) => [
        { role: "assistant", content: [{ type: "tool_use", id: `t${n}-${k}`, name: "read", input: { path: p } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}-${k}`, content: `contents of ${p} ${"x".repeat(2000)}` }] },
      ]),
    };
  });
  const doc = settingsFor({});
  /** @type {string[]} */
  const stats = [];
  const realStat = fs.statSync;
  fs.statSync = /** @type {any} */ ((/** @type {any[]} */ ...a) => {
    if (String(a[0]).startsWith(root)) stats.push(String(a[0]));
    return realStat(.../** @type {[any]} */ (a));
  });
  syncBuiltinESMExports();
  try {
    const p = await rig({ turns }).compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000), root });
    assert.equal(p.methods.summary.headTurns, 12);
    assert.equal(stats.length, new Set(stats).size, `each file stat'd once: ${stats.length} stats of ${new Set(stats).size} files`);
    assert.equal(new Set(stats).size, 36, "every file the summarized turns used was looked for");
    // The summary takes its time, and what it brings back is the disk as it lands: a file back since the plan is shown.
    stats.length = 0;
    const r = rig({ turns, answer: async () => (writeFileSync(join(root, "gone-12-c.txt"), "back again\n"), "THE SUMMARY") });
    const out = await r.compactor.run({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000), trigger: "manual", method: "summary", root });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(r.rows[0].attached.files, [{ path: "gone-12-c.txt", shown: true }]);
    assert.ok(stats.filter((s) => s.endsWith("gone-12-c.txt")).length >= 2, "read once for the plan and again once the summary was written");
  } finally {
    fs.statSync = realStat;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("run summary: today's rule — every finished turn since the head, the head's summary read first, one row with the method; the kind says who asked", async () => {
  const turns = turnsOf(4);
  const doc = settingsFor({});
  const r = rig({ turns });
  const head = { id: 1, from_turn: 1, to_turn: 2, kind: "plain", method: "summary", text: "EARLIER: turns one and two" };
  const out = await runWith(r, { doc, turns, compactions: [head] });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual({ method: out.method, kind: out.kind, fromTurn: out.fromTurn, toTurn: out.toTurn, model: out.model, how: out.how }, { method: "summary", kind: "manual", fromTurn: 1, toTurn: 4, model: "m", how: "call" });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].model, "m"); assert.equal(r.calls[0].purpose, "compact"); assert.equal(r.calls[0].chainId, "c1");
  assert.match(r.calls[0].user, /\[The summary an earlier compaction wrote of turns 1–2\]\nEARLIER: turns one and two/, "the head's summary leads the transcript");
  // Said for what it is: not the lead the continuing model reads, which says to carry on without recapping (AH-D9 c).
  // (fails before: yes — the transcript carried the lead itself)
  assert.doesNotMatch(r.calls[0].user, /without recapping/);
  assert.match(r.calls[0].user, /## Turn 3/); assert.match(r.calls[0].user, /## Turn 4/);
  assert.doesNotMatch(r.calls[0].user, /## Turn 1\b/, "turns under the head are its summary's");
  assert.deepEqual(r.rows.map((x) => ({ fromTurn: x.fromTurn, toTurn: x.toTurn, summaryText: x.summaryText, method: x.method, kind: x.kind })), [{ fromTurn: 1, toTurn: 4, summaryText: "THE SUMMARY", method: "summary", kind: "manual" }]);
  assert.match(out.note, /turns 1–4 summarized on request by m$/);
});

// (fails before: yes — writer model with no model named refused, where memory's cheap model is the side model; and auto
// weighed the two by the moment's prices, a way the owner's rules of 10-31 take away)
test("the writer: null keeps today's rule; session is the same model; model is the side model — the one named, else memory's model; with neither it refuses", () => {
  const pricing = {
    "house-big": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    "house-cheap": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  };
  const r = rig({ pricing });
  const w = (compaction, cache = null) => r.compactor.writerFor({ doc: settingsFor({ context: { compaction } }), sessionModel: "house-big", cache, transcriptTokens: 100_000, outTokens: 6000 });
  assert.deepEqual([w({}).chosen.model, w({}).chosen.fork], ["house-big", false], "null: the session's model");
  assert.equal(w({ model: "house-other" }).chosen.model, "house-other", "null with a named model: the named one (today's rule)");
  assert.equal(w({ writer: "session", model: "house-other" }).chosen.model, "house-big");
  assert.equal(w({ writer: "model", model: "house-other" }).chosen.model, "house-other");
  assert.deepEqual([w({ writer: "model" }).chosen.model, w({ writer: "model" }).chosen.why], ["house-cheap", "memory's model (writer: model)"], "none named: memory's model is the side model");
  const none = rig({ summarizer: "" }).compactor.writerFor({ doc: settingsFor({ context: { compaction: { writer: "model" } } }), sessionModel: "house-big", cache: null, transcriptTokens: 1000, outTokens: 1000 });
  assert.equal(none.chosen, null); assert.match(none.error, /^no side model to summarize with: name one in context\.compaction\.model, or set memory's model \(Settings › Memory › Model\)/);
  // A writer value no layer holds any more reads as none: the session's model.
  assert.equal(w({ writer: "auto", model: "house-other" }).chosen.model, "house-other", "an old auto is no choice: today's rule");
  // Warm on the session's model: the same model forks; a warm cache of another model is nothing to fork.
  const warm = w({ writer: "session" }, { state: "warm", leftMs: 200_000, tokens: 100_000, model: "agent/house-big" });
  assert.deepEqual([warm.chosen.model, warm.chosen.fork], ["house-big", true]);
  assert.equal(w({}, { state: "warm", leftMs: 1, tokens: 1, model: "other" }).chosen.fork, false);
  assert.equal(w({}, { state: "cold", leftMs: 0, tokens: 1, model: "house-big" }).chosen.fork, false);
});

// (fails before: yes — every compaction summary re-read the whole conversation as plain input, whatever the cache held)
test("the fork writer: a warm cache on the session's model writes the summary from the conversation itself, guarded by the turn it must end on; cold, failed or trimmed, the transcript path", async () => {
  const turns = turnsOf(3);
  const doc = settingsFor({});
  const forks = [];
  // The fork thinks in notes first (AH-D9 a); only the summary is stored. (fails before: yes — the notes were stored too)
  let answer = { ok: true, text: "<analysis>\nNOTES ON TURNS 1–3\n</analysis>\n<summary>\nFORKED SUMMARY\n</summary>" };
  const subagents = {
    // A kept request that leaves a summary room under the 20,000-token window (a fuller one is not forked: the preview test).
    cacheOf: () => ({ state: "warm", leftMs: 100_000, tokens: 3000, model: "m" }),
    forkCall: async (chainId, instruction, o) => {
      forks.push({ chainId, instruction, ...o });
      return answer;
    },
  };
  const r = rig({ turns, subagents });
  const out = await runWith(r, { doc, turns });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.how, "fork");
  assert.equal(r.calls.length, 0, "no transcript call");
  assert.equal(forks.length, 1);
  assert.equal(forks[0].instruction, FORK_SUMMARY_INSTRUCTION);
  assert.equal(forks[0].model, "m");
  assert.equal(forks[0].endsWith, "Turn 3 done: f3.txt read.", "the fork must hold the conversation through the newest turn");
  // (fails before: yes — the fork was tried once: a busy provider sent the summary to the transcript path; AH-F4)
  assert.deepEqual([forks[0].window, forks[0].minTokens, forks[0].stream, forks[0].textOnly, forks[0].retry], [20000, FORK_MIN_TOKENS, true, true, true], "the reply fitted to the session's window, streamed, a tool call is no summary, and a busy provider is tried again");
  // (fails before: yes — the fork's summary was capped at 20,000 tokens: HarnessV3-FailurePoints §13)
  assert.ok(!("maxTokens" in forks[0]), "no cap of its own: the kept request's allowance, fitted to the window");
  assert.equal(r.rows[0].summaryText, "FORKED SUMMARY");
  assert.match(out.note, /by m, from its warm cache/);
  // The kept request no longer ends on that turn (null) — the transcript path.
  answer = null;
  const cold = await runWith(r, { doc, turns });
  assert.equal(cold.how, "call"); assert.equal(r.calls.length, 1);
  // The fork failed — logged, and the transcript path still writes the summary.
  answer = { ok: false, error: "HTTP 529" };
  const failed = await runWith(r, { doc, turns });
  assert.equal(failed.how, "call");
  assert.ok(r.logs.some((l) => /compaction fork failed \(HTTP 529\); summarizing the transcript instead/.test(l)));
  // A stop ended the fork: nothing more is called and no failure is logged of it. (fails before: yes — the look of
  // HarnessV4_Tasks U3-5: every Stop wrote "compaction fork failed (This operation was aborted); summarizing the
  // transcript instead", and the transcript path was entered with a dead signal)
  const stop = new AbortController();
  const [calls, lines] = [r.calls.length, r.logs.length];
  subagents.forkCall = async () => (stop.abort(), { ok: false, error: "This operation was aborted" });
  const stopped = await runWith(r, { doc, turns, signal: stop.signal });
  assert.deepEqual([stopped.ok, stopped.status, stopped.error], [false, 409, "stopped before anything was written"]);
  assert.deepEqual([r.calls.length, r.logs.length], [calls, lines], "no transcript call, no line in the log");
  subagents.forkCall = async (chainId, instruction, o) => (forks.push({ chainId, instruction, ...o }), answer);
  // A fork whose notes ran out of room wrote no summary: the transcript path. (fails before: yes — the notes were the summary)
  answer = { ok: true, text: "<analysis>\nNOTES THAT NEVER END" };
  const notesOnly = await runWith(r, { doc, turns });
  assert.equal(notesOnly.how, "call");
});

// (fails before: yes — the slices read the turns whole, every call and its result, where their folds were the last resort's
// reading: the owner's rules of 10-31)
test("turns too big for the writer's slice budget even with their tool calls folded are summarized in the slice pass's sequential slices of the folds, sized to the writer's window (assumed when nobody states one)", async () => {
  const turns = turnsOf(4, { finalBig: 3800 });
  const doc = settingsFor({});
  const sliced = [];
  /** @type {any[]} */
  const steps = [];
  const r = rig({ turns, sliceConfig: { maxSliceTokens: 2000 }, sliceSummarize: async (o) => { sliced.push(o); o.onProgress({ step: "trim", message: "summarizing slice 1", percent: 0 }); return { text: "SLICED SUMMARY", calls: 3 }; } });
  const head = { id: 1, from_turn: 1, to_turn: 1, kind: "plain", text: "EARLIER" };
  const out = await runWith(r, { doc, turns, compactions: [head], onStep: (s) => steps.push(s) });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.how, "slices");
  // (fails before: yes — HarnessV4_Tasks C27: a slice pass said nothing of how many calls it expects, so the page made
  // a total of the calls begun so far)
  const planned = (await r.compactor.plan({ chain: CHAIN, doc, turns, compactions: [head], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000) })).methods.summary.slices;
  assert.ok(planned > 1, `the plan counts more than one slice: ${planned}`);
  assert.deepEqual(steps.find((s) => s.message === "summarizing slice 1"), { message: "summarizing slice 1", percent: 0, planned }, "each step of the pass carries the total the plan counted");
  assert.equal(r.calls.length, 0, "no single call over the budget");
  assert.equal(sliced.length, 1);
  assert.equal(sliced[0].model, "m"); assert.equal(sliced[0].windowTokens, ASSUMED_WINDOW); assert.equal(sliced[0].chainId, "c1");
  assert.match(sliced[0].messages[0].content[0].text, /^\[The summary an earlier compaction wrote of turn 1\]\nEARLIER/, "the head's summary is the first message the slices read");
  assert.equal(sliced[0].messages.length, 2 + 3 * 2, "the head's pair, then turns 2–4 folded, two messages a turn");
  assert.ok(sliced[0].messages.every((m) => (Array.isArray(m.content) ? m.content : []).every((b) => b.type === "text")), "words alone: no call, no result");
  assert.equal(r.rows[0].summaryText, "SLICED SUMMARY");
  assert.equal(r.rows[0].detail.folded, true, "the row says the turns were read folded");
  assert.match(out.note, /by m, in 3 slices, from the turns with their tool calls folded \(too big whole for one call\)/);
  assert.equal(writerWindow({ routes: [], upstreams: [] }, "anything").source, "assumed");
});

// (fails before: yes — HarnessV4_Tasks C33: the time was the writer's first byte and its rate, which leaves out what it
// thinks before it writes: 21 s said, 57 s taken)
test("plan: a way's time is how long that writer's summaries have taken, whole, a call each; its speed stands in where it has written none", async () => {
  const turns = turnsOf(4, { finalBig: 400 });
  const doc = settingsFor({});
  const speedOf = () => ({ ttftMs: 2000, tps: 50, calls: 12 });
  /** @type {[string, string][]} */
  const asked = [];
  const timeOf = (/** @type {string} */ model, /** @type {string} */ kind) => { asked.push([model, kind]); return kind === "compact" ? { ms: 57_000, calls: 3 } : null; };
  const p = await rig({ turns, speedOf, timeOf }).compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000) });
  assert.deepEqual([p.methods.summary.slices, p.methods.summary.aboutMs], [1, 57_000], "one call: one past summary's time");
  assert.ok(asked.some(([model, kind]) => model === "m" && kind === "compact"));
  assert.ok(asked.every(([, kind]) => kind === "compact"));
  const bySpeed = await rig({ turns, speedOf, timeOf: () => null }).compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000) });
  assert.equal(bySpeed.methods.summary.aboutMs, Math.round(2000 + (bySpeed.methods.summary.summaryTokens / 50) * 1000), "no summary of its in the log: its first byte, then its rate");
  const big = turnsOf(8, { finalBig: 3000 });
  const sliced = await rig({ turns: big, sliceConfig: { maxSliceTokens: 2000 }, speedOf, timeOf }).compactor.plan({ chain: CHAIN, doc, turns: big, compactions: [], sessionModel: "m", window: 200000, measure: measureFor(doc, 200000) });
  assert.ok(sliced.methods.summary.slices > 1);
  assert.equal(sliced.methods.summary.aboutMs, sliced.methods.summary.slices * 57_000, "its slices, one after another");
});

// (fails before: yes — HarnessV4_Tasks C26: a way said its cost and its calls, and nothing of how long they take)
test("plan: about how long each way takes, by its writer's measured speed in the request log — its calls one after another; no finished call of the writer, no time said", async () => {
  const turns = turnsOf(4, { finalBig: 400 });
  const doc = settingsFor({});
  const planWith = (/** @type {any} */ speedOf, /** @type {any} */ o = {}) => rig({ turns, speedOf, ...o }).compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000) });
  /** @type {string[]} */
  const asked = [];
  const p = await planWith((/** @type {string} */ model) => { asked.push(model); return model === "m" ? { ttftMs: 2000, tps: 50, calls: 12 } : null; });
  const sum = p.methods.summary;
  assert.deepEqual([sum.slices, sum.model], [1, "m"]);
  assert.equal(sum.aboutMs, Math.round(2000 + (sum.summaryTokens / 50) * 1000), "one call: its first byte, then the summary at the writer's rate");
  assert.ok(asked.includes("m"));
  assert.equal(p.methods.fold.aboutMs, undefined, "a fold calls no model: no time to say");
  assert.deepEqual([(await planWith(null)).methods.summary.aboutMs, (await planWith(() => null)).methods.summary.aboutMs], [null, null]);
  // Sliced: each call writes a slice's summary, and they go one after another.
  const big = turnsOf(4, { finalBig: 3800 });
  const sliced = await rig({ turns: big, sliceConfig: { maxSliceTokens: 2000 }, speedOf: () => ({ ttftMs: 1000, tps: 100, calls: 3 }) }).compactor.plan({ chain: CHAIN, doc, turns: big, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000) });
  assert.ok(sliced.methods.summary.slices > 1, String(sliced.methods.summary.slices));
  assert.ok(sliced.methods.summary.aboutMs >= sliced.methods.summary.slices * 1000, "at least each call's first byte");
  assert.equal(sliced.methods.summary.aboutMs % sliced.methods.summary.slices, 0, "the same for every call, added up");
});

// (fails before: yes — neither existed: a fork carried the kept request's whole max_tokens, and the loop's fold chose
// its writer by the compaction model alone)
test("the fit rule a fork's reply obeys, and the one writer rule the loop's fold asks with its own cache", () => {
  assert.equal(replyHeadroom(20_000), 1536); assert.equal(replyHeadroom(200_000), 4000);
  assert.equal(fittedMaxTokens({ window: 200_000, request: 170_000, cap: 20_000 }), 20_000, "room enough: the cap");
  assert.equal(fittedMaxTokens({ window: 200_000, request: 190_000, cap: 20_000 }), 6000, "the window less the request and the headroom");
  assert.equal(fittedMaxTokens({ window: 200_000, request: 190_000, cap: 20_000, floor: 8000 }), null, "under the floor: none");
  assert.equal(fittedMaxTokens({ window: 200_000, request: 190_000, cap: 20_000, thinking: 6000 }), null, "not above the thinking budget: none");
  assert.equal(fittedMaxTokens({ window: 0, request: 190_000, cap: 20_000 }), 20_000, "no window known: the cap, and the provider judges");
  const cfg = { rules: {}, routes: [], upstreams: [] };
  const warm = { state: /** @type {const} */ ("warm"), leftMs: 60_000, tokens: 90_000, model: "m" };
  const pick = (/** @type {any} */ compaction, cache = warm) => chooseWriter({ cfg, doc: settingsFor({ context: { compaction } }), sessionModel: "m", cheapModel: "cheap", cache, transcriptTokens: 20_000, outTokens: 1200 }).chosen;
  assert.deepEqual([pick({}).model, pick({}).fork], ["m", true], "today's rule, warm: the loop's own model forks");
  assert.deepEqual([pick({}, null).model, pick({}, null).fork], ["m", false]);
  assert.deepEqual([pick({ model: "cheap" }).model, pick({ model: "cheap" }).fork], ["cheap", false], "a named compaction model writes it — no fork of another model's cache");
  assert.match(roundsForkInstruction(3), /except your last 3 rounds of tool calls and their results/);
  assert.match(roundsForkInstruction(1), /except your last 1 round of tool calls/);
  // Who asked is in the first words: the line, or the developer's own Compact (HarnessV3-FixRound F1 item 9).
  assert.match(roundsForkInstruction(2), /^\[Filament: this turn has reached the compaction line\. Write the summary/);
  assert.match(roundsForkInstruction(2, "line"), /^\[Filament: this turn has reached the compaction line\./);
  assert.match(roundsForkInstruction(2, "manual"), /^\[Filament: the developer asked to compact this turn now\. Write the summary/);
  assert.doesNotMatch(roundsForkInstruction(2, "manual"), /compaction line/);
  assert.match(roundsForkInstruction(2, "manual"), /except your last 2 rounds of tool calls/, "the same cut either way");
});

// (fails before: yes — HarnessV4_Tasks C33: a named model that reached a coding agent was refused, and memory's that
// did was passed over)
test("a session on a coding agent is summarised by the model named, else memory's, never in its warm session (HarnessV3-ACP AC5-2); a coding agent's model the person named, or gave memory, writes as any model does, marked as an agent's", () => {
  const cfg = {
    rules: {},
    upstreams: [
      { id: "claude", type: "acp", acp: { command: "claude-agent-acp" } },
      { id: "api", type: "openai-compatible", baseUrl: "http://x", pricing: { cheap: { input: 1, output: 5 }, big: { input: 5, output: 25 } } },
    ],
    routes: [{ match: "claude/*", upstream: "claude", upstreamModel: "{1}" }, { match: "cheap", upstream: "api" }, { match: "big", upstream: "api" }],
  };
  const warm = { state: /** @type {const} */ ("warm"), leftMs: 60_000, tokens: 90_000, model: "claude/sonnet" };
  /** @param {any} compaction @param {string} [cheapModel] @param {string} [sessionModel] */
  const pick = (compaction, cheapModel = "cheap", sessionModel = "claude/sonnet") => chooseWriter({ cfg, doc: settingsFor({ context: { compaction } }), sessionModel, cheapModel, cache: { ...warm, model: sessionModel }, transcriptTokens: 20_000, outTokens: 1200 });
  const own = pick({});
  assert.deepEqual([own.chosen?.model, own.chosen?.fork, own.chosen?.why, own.session], ["cheap", false, "memory's model (the session's is a coding agent)", null], "never the agent's warm session");
  for (const writer of ["session", "model"]) assert.equal(pick({ writer }).chosen?.model, "cheap", `whatever the writer choice (${writer})`);
  assert.deepEqual([pick({ model: "big" }).chosen?.model, pick({ model: "big" }).chosen?.why], ["big", "context.compaction.model (the session's is a coding agent)"]);
  assert.deepEqual([pick({}, "").chosen, pick({}, "").error], [null, "no model to summarize with: name one in context.compaction.model (a coding agent's model writes it too, in a session of its own), or set memory's model (Settings › Memory › Model)"], "its own agent stands in for no model nobody named");
  assert.equal(own.chosen?.agent, undefined, "a model Filament calls carries no mark");
  // Memory's model that reaches an agent: that agent writes, in a session of its own, on its plan.
  const memorys = pick({}, "claude/haiku");
  assert.deepEqual([memorys.chosen?.model, memorys.chosen?.fork, memorys.chosen?.agent, memorys.chosen?.cost, memorys.side?.agent, memorys.session], ["claude/haiku", false, true, 0, true, null]);
  // A named one, whatever the session runs on: an API model's session too, where the writer choice still decides.
  const named = pick({ model: "claude/haiku" }, "cheap", "big");
  assert.deepEqual([named.chosen?.model, named.chosen?.fork, named.chosen?.agent, named.chosen?.why, named.error], ["claude/haiku", false, true, "context.compaction.model", undefined]);
  assert.deepEqual([pick({ model: "claude/haiku", writer: "session" }, "cheap", "big").chosen?.model, pick({ model: "claude/haiku", writer: "session" }, "cheap", "big").chosen?.agent], ["big", undefined]);
  assert.equal(pick({ model: "claude/haiku", writer: "model" }, "cheap", "big").chosen?.model, "claude/haiku", "model: the side model named");
  // The session's own agent's model, named: it reads the transcript in a session of its own, never the chat's.
  const same = pick({ model: "claude/sonnet" });
  assert.deepEqual([same.chosen?.model, same.chosen?.fork, same.chosen?.agent, same.session], ["claude/sonnet", false, true, null]);
  assert.deepEqual([pick({}, "cheap", "big").chosen?.model, pick({}, "cheap", "big").chosen?.fork], ["big", true], "an API session: its own model, forked from its warm cache, as before");
});

// (fails before: yes — the hunt of 11-08: a route that falls back on a coding agent made the loop's session on it an
// agent's here, though its turns go to the route's first upstream, a model (agentSessionOf): its summary was written
// cold by the side model, never from its warm cache, and by none where no side model was set)
test("a session on a model whose route falls back on a coding agent is the model's: its summary is written from its warm cache, as any model's session", () => {
  const cfg = {
    rules: {},
    upstreams: [
      { id: "claude", type: "acp", acp: { command: "claude-agent-acp" } },
      { id: "api", type: "openai-compatible", baseUrl: "http://x", pricing: { big: { input: 5, output: 25 } } },
    ],
    routes: [{ match: "big", upstream: "api", fallbacks: [{ upstream: "claude" }] }],
  };
  const warm = { state: /** @type {const} */ ("warm"), leftMs: 60_000, tokens: 90_000, model: "big" };
  const w = chooseWriter({ cfg, doc: settingsFor({ context: { compaction: {} } }), sessionModel: "big", cheapModel: "", cache: warm, transcriptTokens: 20_000, outTokens: 1200 });
  assert.deepEqual([w.chosen?.model, w.chosen?.fork, w.chosen?.why, w.chosen?.agent, w.error], ["big", true, "the session's model", undefined, undefined]);
});

test("the agent writes the summary of its own session (HarnessV3-ACP AC5-4): the summary method whatever the session's, no model of Filament's needed, a fork's instruction, what it cost in the op", async () => {
  const turns = turnsOf(3);
  const doc = settingsFor({ context: { compaction: { method: "fold" } } });
  const r = rig({ turns, summarizer: "", agent: true });
  /** @type {string[]} */
  const asked = [];
  const self = {
    model: "claude/sonnet",
    write: async (/** @type {string} */ instruction) => (asked.push(instruction), { text: "<analysis>Went through it.</analysis>\n<summary>THE AGENT'S</summary>", how: /** @type {const} */ ("fork"), usage: { input: 5, output: 40, cacheRead: 900, cacheWrite: 0, total: 945 } }),
  };
  /** @param {any} [o] */
  const run = (o = {}) => r.compactor.run({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "claude/sonnet", window: 20000, measure: measureFor(doc, 20000), trigger: "line", ...o });
  const without = await run({ method: "summary" });
  assert.deepEqual([without.ok, /** @type {any} */ (without).status], [false, 400], "Filament has no model to write with");
  /** @type {any[]} */
  const steps = [];
  const out = await run({ self, onStep: (/** @type {any} */ s) => steps.push(s.message) });
  assert.equal(out.ok, true, /** @type {any} */ (out).error);
  assert.deepEqual([out.method, out.fromTurn, out.toTurn, out.how, out.model], ["summary", 1, 3, "agent-fork", "claude/sonnet"]);
  assert.deepEqual(steps, ["claude/sonnet writes the summary of its own session"], "its step, for the compaction's progress (HarnessV3-FailurePoints §5.1 item 3)");
  assert.equal(r.calls.length, 0);
  assert.deepEqual(asked, [FORK_SUMMARY_INSTRUCTION]);
  assert.equal(r.rows[0].summaryText, "THE AGENT'S", "its analysis dropped");
  assert.equal(/** @type {any} */ (out).note, "compaction: turns 1–3 summarized at the compaction line by claude/sonnet, the agent itself, in a fork of its session");
  const d = r.recorded.at(-1)[2].detail;
  assert.deepEqual([d.how, d.inputTokens, d.outputTokens, d.cacheReadTokens, d.cacheWriteTokens], ["agent-fork", 5, 40, 900, 0]);
  const inPlace = await run({ self: { ...self, write: async () => ({ text: "<summary>IN PLACE</summary>", how: /** @type {const} */ ("session"), usage: null }) } });
  assert.match(/** @type {any} */ (inPlace).note, /by claude\/sonnet, the agent itself, in its session$/);
  assert.equal("inputTokens" in r.recorded.at(-1)[2].detail, false, "no figures the agent did not give");
});

test("an agent's summary that fails, comes back empty or is stopped writes nothing, and says whose it was", async () => {
  const doc = settingsFor({});
  const turns = turnsOf(3);
  const r = rig({ turns });
  /** @param {() => Promise<any>} write @param {AbortSignal | null} [signal] */
  const run = (write, signal = null) => r.compactor.run({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "claude/sonnet", window: 20000, measure: measureFor(doc, 20000), trigger: "manual", signal, self: { model: "claude/sonnet", write } });
  const failed = await run(async () => { throw new Error("Internal error: Overloaded"); });
  assert.deepEqual([failed.ok, /** @type {any} */ (failed).status, /** @type {any} */ (failed).error], [false, 502, "the agent (claude/sonnet) failed: Internal error: Overloaded"]);
  const empty = await run(async () => ({ text: "<analysis>Nothing to say.</analysis>", how: "fork", usage: null }));
  assert.deepEqual([/** @type {any} */ (empty).status, /** @type {any} */ (empty).error], [502, "the agent (claude/sonnet) returned an empty summary"]);
  const stop = new AbortController();
  const stopped = await run(async () => {
    stop.abort();
    throw new Error("stopped while the agent wrote the summary");
  }, stop.signal);
  assert.deepEqual([/** @type {any} */ (stopped).status, /** @type {any} */ (stopped).error], [409, "stopped before anything was written"]);
  assert.deepEqual([r.rows.length, r.calls.length], [0, 0], "nothing written, and no model of Filament's asked instead: that is the session's to decide");
});

// (fails before: yes — a summary that failed at the line wrote nothing and the turn went out past its line, and one the
// person tired of could only be stopped with the turn: the filament-agent plan's D6)
test("a turn's summary gives way to fold: one that fails, comes back empty or is let go; let go without the fallback, or with nothing to fold, nothing is written", async () => {
  const doc = settingsFor({});
  /** @param {(a: any) => Promise<string>} answer @param {any} [o] @param {any} [d] */
  const runAt = async (answer, o = {}, d = doc) => {
    const turns = turnsOf(3);
    const r = rig({ turns, answer });
    const out = /** @type {any} */ (await r.compactor.run({ chain: CHAIN, doc: d, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(d, 20000), trigger: "line", method: "summary", ...o }));
    return { out, r, rows: r.rows.map((x) => [x.method, x.summaryText, x.fromTurn, x.toTurn]) };
  };
  const down = async () => {
    throw new Error("the model is down");
  };
  const failed = await runAt(down, { fallback: true });
  assert.deepEqual([failed.out.ok, failed.out.method, failed.out.how, failed.out.model], [true, "fold", "local", null]);
  assert.match(failed.out.note, /^compaction: turns 1–2 folded at the compaction line \(the compaction model \(m\) failed: the model is down, so folding made the room; it calls no model\) — /);
  assert.deepEqual(failed.rows, [["fold", null, 1, 2]], "the fold's row, no summary's");
  assert.equal(failed.r.calls.length, 1, "the summary was asked once, then fold asked nothing");

  const without = await runAt(down);
  assert.deepEqual([without.out.ok, without.out.status, without.out.error, without.rows], [false, 502, "the compaction model (m) failed: the model is down", []], "no fallback: the failure, as before");

  const empty = await runAt(async () => "  ", { fallback: true });
  assert.match(empty.out.note, /folded at the compaction line \(the compaction model \(m\) returned an empty summary, so folding made the room; it calls no model\)/);

  // Let go while it writes: the writer hears it, and fold makes the room.
  /** @param {AbortController} skip */
  const waitsFor = (skip) => (/** @type {any} */ a) =>
    new Promise((_, rej) => {
      a.signal?.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
      queueMicrotask(() => skip.abort());
    });
  let skip = new AbortController();
  const letGo = await runAt(waitsFor(skip), { fallback: true, skip: skip.signal });
  assert.ok(letGo.r.calls[0].signal?.aborted, "the writer was stopped");
  assert.deepEqual([letGo.out.ok, letGo.out.method], [true, "fold"]);
  assert.match(letGo.out.note, /^compaction: turns 1–2 folded at the compaction line \(you sent it on without the summary; folding calls no model\) — /);
  // A writer that ends early with what it has (a slice pass) is no summary the person waited for.
  skip = new AbortController();
  const ref = skip;
  const partial = await runAt(async () => (ref.abort(), "PART OF IT"), { fallback: true, skip: skip.signal });
  assert.deepEqual(partial.rows, [["fold", null, 1, 2]], "fold, not the part");

  // An agent's session goes on as it is (no fallback): nothing is written.
  skip = new AbortController();
  const agent = await runAt(waitsFor(skip), { skip: skip.signal });
  assert.deepEqual([agent.out.ok, agent.out.status, agent.out.error, agent.rows], [false, 409, "sent on without the summary", []]);
  // Every turn kept whole: fold has nothing to make room with, and the failure stands.
  const whole = settingsFor({ context: { compaction: { keepWhole: 5 } } });
  const none = await runAt(down, { fallback: true }, whole);
  assert.deepEqual([none.out.ok, none.out.status, none.out.error, none.rows], [false, 502, "the compaction model (m) failed: the model is down", []]);
  skip = new AbortController();
  const noneLetGo = await runAt(waitsFor(skip), { fallback: true, skip: skip.signal }, whole);
  assert.equal(noneLetGo.out.status, 409);
  assert.match(noneLetGo.out.error, /^sent on without the summary, and fold has no room to make: /);
  // The turn's own stop is a stop, whatever else was asked.
  const stop = new AbortController();
  skip = new AbortController();
  const stopped = await runAt(waitsFor(stop), { fallback: true, skip: skip.signal, signal: stop.signal });
  assert.deepEqual([stopped.out.ok, stopped.out.status, stopped.out.error, stopped.rows], [false, 409, "stopped before anything was written", []]);
});

test("on a subscription plan (Providers P4) a writer pays $0, its list price said beside it; two priced models are ordered by what is paid, the list price breaking a tie", () => {
  const cfg = {
    rules: {},
    upstreams: [
      { id: "sub", type: "openai-compatible", baseUrl: "http://x", billing: "plan", pricing: { big: { input: 5, output: 25 }, small: { input: 1, output: 5 } } },
      { id: "meter", type: "openai-compatible", baseUrl: "http://y", pricing: { cheap: { input: 0.5, output: 2 } } },
    ],
    routes: [{ match: "big", upstream: "sub" }, { match: "small", upstream: "sub" }, { match: "bare", upstream: "sub" }, { match: "cheap", upstream: "meter" }],
  };
  const pick = (/** @type {string} */ sessionModel, /** @type {string} */ cheapModel) => chooseWriter({ cfg, doc: settingsFor({ context: { compaction: { writer: "model" } } }), sessionModel, cheapModel, cache: null, transcriptTokens: 20_000, outTokens: 1200 });
  const w = pick("small", "big");
  assert.deepEqual([w.chosen?.model, w.chosen?.cost, w.chosen?.listCost], ["big", 0, 0.16], "paid nothing; 20K in, and the 1.2K summary with its notes out, at the card beside it");
  assert.deepEqual([pick("big", "cheap").side?.cost, pick("big", "cheap").side?.listCost], [0.0148, 0.0148], "metered: what is paid is the list price");
  assert.equal(pick("small", "bare").session?.cost, 0, "a plan model nobody prices still pays $0");
  assert.deepEqual(pricedOf(cfg, "small", { input: 1e6 }), { cost: 0, listCost: 1 });
  assert.deepEqual(pricedOf(cfg, "cheap", { input: 1e6 }), { cost: 0.5, listCost: 0.5 });
  assert.equal(cheaperOf({ cost: null, listCost: null }, { cost: null, listCost: null }), false, "neither priced: the second by its name");
  assert.equal(cheaperOf({ cost: 0, listCost: null }, { cost: 0, listCost: null }), true, "an even tie keeps the first");
  assert.equal(cheaperOf({ cost: 0.2, listCost: 0.2 }, { cost: null, listCost: null }), true);
  assert.equal(cheaperOf({ cost: 0.2, listCost: 0.2 }, { cost: 0.1, listCost: 0.1 }), false);
  assert.equal(cheaperOf({ cost: 0, listCost: 0.3 }, { cost: 0, listCost: 0.3 }), true, "equal on both: the first");
});

// (fails before: yes — every session's summary read each call's result, 800 characters of it: a coding agent's turns
// read at many times what Filament's copy of them holds, and the loop's too big for one call took slices where their
// folds take one)
test("a coding agent's session is summarized from its turns' folds, and the loop's too big whole for one call from theirs: one call each, no tool output read", async () => {
  const doc = settingsFor({});
  const turns = turnsOf(12);
  const measure = measureFor(doc, 200000);
  /** @type {any[]} */
  const sliced = [];
  const make = () => rig({ turns, agent: true, sliceConfig: { maxSliceTokens: 2000 }, sliceSummarize: async (/** @type {any} */ o) => { sliced.push(o); return { text: "SLICED", calls: 2 }; } });
  const on = (/** @type {string} */ sessionModel) => ({ chain: CHAIN, doc, turns, compactions: [], sessionModel, window: 200000, measure });
  const loop = make(), agent = make();
  const lp = await loop.compactor.plan(on("m"));
  const ap = await agent.compactor.plan(on("claude/sonnet"));
  assert.deepEqual([lp.methods.summary.reads, lp.methods.summary.slices], ["folded", 1], `the loop's turns, too big whole, fold first: ${lp.methods.summary.transcriptTokens}`);
  assert.deepEqual([ap.methods.summary.reads, ap.methods.summary.slices], ["whole", 1], `a coding agent's copy is its folds: ${ap.methods.summary.transcriptTokens}`);
  const out = await agent.compactor.run({ ...on("claude/sonnet"), trigger: "manual", method: "summary" });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([out.how, out.model, sliced.length], ["call", "house-cheap", 0]);
  const read = String(agent.calls[0].user);
  assert.ok(read.includes("⚙ read f1.txt") && read.includes("Turn 12 done: f12.txt read."), "each call on a line, and the agent's words");
  assert.ok(!read.includes("contents of file"), "no tool output");
  const folded = await loop.compactor.run({ ...on("m"), trigger: "manual", method: "summary" });
  assert.deepEqual([folded.ok, folded.ok && folded.how, sliced.length], [true, "call", 0], "one call, no slices");
  assert.ok(!String(loop.calls[0].user).includes("contents of file"), "the loop's turns read folded");
  assert.match(String(folded.ok && folded.note), /from the turns with their tool calls folded/);
});

// (fails before: yes — the slices read a coding agent's turns whole: every call and every result)
test("a coding agent's session too long for one call goes to the slice pass as its folds, the head's summary first", async () => {
  // No instant fold: the side model's folded turns would be one here (the owner's rules of 10-31).
  const doc = settingsFor({ context: { compaction: { instantTokens: 0 } } });
  const turns = turnsOf(61);
  /** @type {any[]} */
  const sliced = [];
  const r = rig({ turns, agent: true, sliceConfig: { maxSliceTokens: 2000 }, sliceSummarize: async (/** @type {any} */ o) => { sliced.push(o); return { text: "SLICED", calls: 2 }; } });
  const head = { id: 1, from_turn: 1, to_turn: 1, kind: "plain", text: "EARLIER" };
  const out = await r.compactor.run({ chain: CHAIN, doc, turns, compactions: [head], sessionModel: "claude/sonnet", window: 200000, measure: measureFor(doc, 200000), trigger: "manual", method: "summary" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.how, "slices");
  const ms = sliced[0].messages;
  assert.match(ms[0].content[0].text, /^\[The summary an earlier compaction wrote of turn 1\]\nEARLIER/);
  assert.equal(ms.length, 2 + 60 * 2, "the head's pair, then two messages a turn");
  assert.ok(ms.every((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []).every((/** @type {any} */ b) => b.type === "text")), "words alone: no call, no result");
  assert.match(ms[3].content[0].text, /⚙ read f2\.txt/);
});

/**
 * The copy's summary as the session service asks for it: weighed (`copyRead`), then written from what was weighed.
 * @param {ReturnType<typeof rig>} r @param {any} o
 */
const copyBy = async (r, { turns, compactions, ...o }) =>
  r.compactor.copy({ ...o, reads: await r.compactor.copyRead({ turns, compactions, measure: measureFor(o.doc, 200_000) }) });

// (fails before: yes — where a coding agent handed no summary over, nothing wrote one for Filament's copy: it kept every turn)
test("copy: a summary for Filament's copy alone — the summary before read whole, the turns since as their folds, all but the newest; no session moves, nothing is learned or brought back", async () => {
  const doc = settingsFor({});
  // Turns 4–7 outweigh the summary the copy stands on: a summary of them makes the copy smaller.
  const turns = turnsOf(8, { big: 12000 });
  /** @type {any[]} */
  const learned = [];
  const r = rig({ turns, agent: true, compacted: (/** @type {string} */ id) => (learned.push(id), { learning: false, why: "" }) });
  const head = { id: 7, from_turn: 1, to_turn: 3, kind: "plain", method: "summary", text: `EARLIER ${"fact ".repeat(9000)}LAST-FACT`, detail: {} };
  /** @type {any[]} */
  const steps = [];
  const on = { chain: CHAIN, doc, turns, compactions: [head], sessionModel: "claude/sonnet", why: /** @type {const} */ ("agent"), by: "Codex", fresh: () => [head], onStep: (/** @type {any} */ s) => steps.push(s.message) };
  const out = await copyBy(r, on);
  assert.equal(out.ok, true, out.error);
  assert.deepEqual([out.fromTurn, out.toTurn, out.method, out.kind, out.model, out.how], [1, 7, "summary", "plain", "house-cheap", "call"]);
  const read = String(r.calls[0].user);
  assert.ok(read.includes("[The summary an earlier compaction wrote of turns 1–3]") && read.includes("LAST-FACT"), "the summary the copy stood on, to its end");
  assert.ok(read.includes("## Turn 4") && read.includes("## Turn 7") && !read.includes("## Turn 8") && !read.includes("## Turn 3"), "turns 4–7: the newest stays as it was said");
  assert.ok(read.includes("⚙ read f5.txt") && !read.includes("contents of file"), "as their folds: no tool output");
  const row = r.rows[0];
  assert.deepEqual([row.fromTurn, row.toTurn, row.kind, row.window, row.method, row.summaryText, row.attached], [1, 7, "plain", "harness", "summary", "THE SUMMARY", undefined]);
  assert.deepEqual({ ...row.detail, before: 0, after: 0 }, { copy: "agent", by: "Codex", before: 0, after: 0, exact: false, model: "house-cheap", how: "call", ms: 0 });
  assert.ok(row.detail.before > row.detail.after && row.detail.after > 0, "what it read and what it wrote");
  assert.equal(learned.length, 0, "no learning run");
  assert.match(out.note, /^compaction: turns 1–7 summarized for Filament's copy of the chat alone, by house-cheap — Codex compacted its own context and handed no summary over; the agent's own session goes on as it is, and a fresh one starts from this summary and the turns since$/);
  assert.deepEqual(r.recorded.at(-1)[2].sub, "copy");
  assert.deepEqual(steps, ["house-cheap writes the summary in one call"]);
  // The line's: said so.
  const line = rig({ turns, agent: true });
  const lined = await copyBy(line, { ...on, compactions: [], fresh: () => [], why: "line", by: null });
  assert.deepEqual([lined.ok && lined.fromTurn, lined.ok && lined.toTurn, line.rows[0].detail.copy, line.rows[0].detail.by], [1, 7, "line", undefined]);
  assert.match(lined.ok ? lined.note : "", /by house-cheap — the copy passed the session's compaction line; /);
});

test("copy: nothing is written where the copy moved on meanwhile, where there is nothing but the newest turn, with no model, or once stopped", async () => {
  const doc = settingsFor({});
  const turns = turnsOf(5);
  const on = (/** @type {any} */ o = {}) => ({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "claude/sonnet", why: /** @type {const} */ ("agent"), by: "Codex", fresh: () => [], ...o });
  // The person compacted while it wrote: their summary reaches those turns.
  const moved = rig({ turns, agent: true });
  const late = await copyBy(moved, on({ fresh: () => [{ id: 9, from_turn: 1, to_turn: 5, text: "THEIRS", method: "summary", detail: {} }] }));
  assert.deepEqual([late.ok, late.status, late.error, moved.rows.length, moved.calls.length], [false, 409, "Filament's copy starts after turn 5 by now: nothing was written", 0, 1]);
  // A head behind these turns does not stand in the way.
  const behind = rig({ turns, agent: true });
  assert.equal((await copyBy(behind, on({ fresh: () => [{ id: 9, from_turn: 1, to_turn: 2, text: "OLDER", method: "summary", detail: {} }] }))).ok, true);
  // One finished turn since the copy's start: it stays, and no model is asked.
  const one = rig({ turns, agent: true });
  const none = await copyBy(one, on({ compactions: [{ id: 1, from_turn: 1, to_turn: 4, text: "S", method: "summary", detail: {} }] }));
  assert.deepEqual([none.ok, none.status, one.calls.length], [false, 409, 0]);
  assert.match(none.error, /^nothing for the copy's summary to stand for: its newest finished turn stays as it was said/);
  // No model named and none of memory's: the session's own agent stands in for none.
  const mute = rig({ turns, agent: true, summarizer: "" });
  const lacking = await copyBy(mute, on());
  assert.deepEqual([lacking.ok, lacking.status, mute.rows.length], [false, 400, 0]);
  assert.match(lacking.error, /^no model to summarize with: name one in context\.compaction\.model \(a coding agent's model writes it too/);
  // Stopped while it wrote; a writer that fails; an empty summary.
  const stop = new AbortController();
  const stopped = rig({ turns, agent: true, answer: async () => (stop.abort(), "TOO LATE") });
  assert.deepEqual(await copyBy(stopped, on({ signal: stop.signal })), { ok: false, status: 409, error: "stopped before anything was written" });
  assert.equal(stopped.rows.length, 0);
  const failing = rig({ turns, agent: true, answer: async () => { throw new Error("upstream 500"); } });
  assert.deepEqual(await copyBy(failing, on()), { ok: false, status: 502, error: "the compaction model (house-cheap) failed: upstream 500" });
  const empty = rig({ turns, agent: true, answer: async () => "" });
  assert.deepEqual(await copyBy(empty, on()), { ok: false, status: 502, error: "the compaction model (house-cheap) returned an empty summary" });
});

// (fails before: yes — the copy's summary was written whatever the turns weighed: on a live Codex session two turns
// of ≈300 tokens became a summary of ≈900, at a model call)
test("copy: written only where it makes the copy smaller — the turns it would stand for, as the copy holds them, weigh more than a summary would; under that the copy keeps them and no model is asked", async () => {
  const doc = settingsFor({});
  const weigh = (/** @type {any[]} */ turns, /** @type {any[]} */ compactions = [], d = doc) => rig({ turns, agent: true }).compactor.copyRead({ turns, compactions, measure: measureFor(d, 200_000) });
  // Five turns of a few words: turns 1–4 weigh less than the 1,000 tokens a summary is guessed to run at the least.
  const small = turnsOf(5, { big: 0 });
  const light = await weigh(small);
  assert.ok(light);
  assert.deepEqual([light.list.map((/** @type {any} */ t) => t.n), light.out, light.worth, light.stands > 0 && light.stands < 1000], [[1, 2, 3, 4], 1000, false, true]);
  const r = rig({ turns: small, agent: true });
  const kept = await copyBy(r, { chain: CHAIN, doc, turns: small, compactions: [], sessionModel: "claude/sonnet", why: "agent", by: "Codex", fresh: () => [] });
  assert.deepEqual([kept.ok, kept.status, r.calls.length, r.rows.length], [false, 409, 0, 0]);
  assert.equal(kept.error, `Filament's copy keeps its turns: the turns it would stand for weigh ≈${light.stands.toLocaleString()} tokens there, no more than a summary would (≈1,000) — Filament writes the copy's summary once they weigh more`);
  // The same turns holding their tool output (Whole): they outweigh a summary.
  const heavy = await weigh(turnsOf(5));
  assert.ok(heavy && heavy.worth && heavy.stands > 1000, JSON.stringify([heavy?.stands, heavy?.out]));
  // Weighed as the copy holds them: the same turns a fold compaction folded weigh a few words each, and are kept.
  const marks = turnsOf(5).map((t, i) => (i < 4 ? { ...t, meta: { ...t.meta, compacted: { shape: "fold", id: 2, at: 1 } } } : t));
  const asFolds = await weigh(marks, [{ id: 2, from_turn: 1, to_turn: 4, kind: "manual", method: "fold", text: null, detail: {} }]);
  assert.deepEqual([asFolds?.worth, (asFolds?.stands ?? 0) < heavy.stands], [false, true]);
  // A summary is guessed to run as the session's earlier ones did: the turns since must outweigh that.
  const head = { id: 1, from_turn: 1, to_turn: 1, kind: "plain", method: "summary", text: "fact ".repeat(9000), detail: {} };
  const after = await weigh(turnsOf(5), [head]);
  assert.deepEqual([after?.list.map((/** @type {any} */ t) => t.n), after?.out, after?.worth], [[2, 3, 4], 9000, false]);
  assert.equal((await weigh(turnsOf(5, { big: 20000 }), [head]))?.worth, true);
  // Nothing but the newest turn: nothing to weigh.
  assert.equal(await weigh(turnsOf(1)), null);
});

// ---- refusals: nothing half-written -------------------------------------------------------------------------------

// (fails before: yes — the look of HarnessV4_Tasks U3-5: a summary's row kept the figure weighed before it was written,
// with a stand-in of at least 1,000 tokens — a short summary of a small session read "7.3k → ≈8.0k")
test("a written summary's row says what the next request weighs with it, measured; in a coding agent's session it stays an estimate", async () => {
  const doc = settingsFor({});
  const turns = turnsOf(3);
  const measure = measureFor(doc, 20000);
  const r = rig({ turns, answer: async () => "A SHORT SUMMARY" });
  const planned = (await r.compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure })).methods.summary.after;
  const out = await runWith(r, { doc, turns, method: "summary" });
  assert.equal(out.ok, true, out.error);
  const weighed = (await measure({ turns, compactions: [{ from_turn: 1, to_turn: 3, kind: "pending", text: "A SHORT SUMMARY", attached: r.rows[0].attached?.text || null }] })).sent;
  assert.ok(weighed < planned, `the summary as written (${weighed}) weighs less than its stand-in (${planned})`);
  assert.deepEqual([out.after, r.rows[0].detail.after, r.rows[0].detail.exact], [weighed, weighed, true]);
  // What a coding agent holds is not Filament's composition: the figure is the better one, and still said as an estimate.
  const r2 = rig({ turns, answer: async () => "A SHORT SUMMARY" });
  const agents = await r2.compactor.run({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure, trigger: "manual", method: "summary", held: 15_000 });
  assert.equal(agents.ok, true, agents.error);
  assert.deepEqual([r2.rows[0].detail.before, r2.rows[0].detail.after, r2.rows[0].detail.exact], [15_000, weighed, false]);
});

// (fails before: yes — HarnessV4_Tasks C30 item 7: Compact now on a short chat wrote a summary longer than its turns,
// and the chat grew by it)
test("a summary that would leave the chat no smaller is not written, said by its figures; a turn that waits on it folds instead", async () => {
  const doc = settingsFor({});
  const long = async () => `THE SUMMARY ${"a long account of very little happening. ".repeat(400)}`;
  const turns = turnsOf(2, { big: 0 });
  const r = rig({ turns, answer: long });
  const out = await runWith(r, { doc, turns, method: "summary" });
  assert.deepEqual([out.ok, out.status], [false, 409]);
  assert.match(String(out.error), /^the compaction model \(m\) wrote a summary that leaves the chat no smaller — ≈[\d,]+ tokens with it, ≈[\d,]+ as it is — so nothing was written$/);
  assert.equal(r.calls.length, 1, "the summary was written…");
  assert.equal(r.rows.length, 0, "…and not kept");
  // A turn waiting on it at the line: folding makes the room, at once and with no model.
  const three = turnsOf(3, { big: 2000 });
  const r2 = rig({ turns: three, answer: long });
  const folded = await r2.compactor.run({ chain: CHAIN, doc, turns: three, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000), trigger: "line", method: "summary", fallback: true });
  assert.equal(folded.ok, true, folded.ok ? "" : folded.error);
  assert.equal(folded.method, "fold");
  assert.match(String(folded.ok && folded.note), /wrote a summary that leaves the chat no smaller .*; folding calls no model\)/);
  assert.deepEqual(r2.rows.map((x) => x.method), ["fold"], "the fold's row alone");
});

test("the guard and the stop are asked right before the write; a failed or empty summary writes nothing; an unknown method is refused", async () => {
  const doc = settingsFor({});
  let turns = turnsOf(3);
  let r = rig({ turns });
  const busy = await runWith(r, { doc, turns, guard: () => "a turn started meanwhile" });
  assert.deepEqual({ ok: busy.ok, status: busy.status, error: busy.error }, { ok: false, status: 409, error: "a turn started meanwhile" });
  assert.equal(r.calls.length, 1, "the summary was written…"); assert.equal(r.rows.length, 0, "…and not stored");
  const foldBusy = await runWith(r, { doc, turns, method: "fold", guard: () => "busy" });
  assert.equal(foldBusy.status, 409); assert.equal(r.rows.length, 0); assert.equal(turns[0].meta.compacted, undefined, "no mark either");
  const stop = new AbortController();
  r = rig({ turns, answer: async () => { stop.abort(); return "LATE"; } });
  const stopped = await runWith(r, { doc, turns, signal: stop.signal });
  assert.deepEqual({ status: stopped.status, error: stopped.error }, { status: 409, error: "stopped before anything was written" });
  assert.equal(r.rows.length, 0);
  r = rig({ turns, answer: async () => { throw new Error("the model is down"); } });
  const down = await runWith(r, { doc, turns });
  assert.equal(down.status, 502); assert.match(down.error, /the compaction model \(m\) failed: the model is down/);
  r = rig({ turns, answer: async () => "   " });
  const empty = await runWith(r, { doc, turns });
  assert.equal(empty.status, 502); assert.match(empty.error, /returned an empty summary/);
  assert.equal(r.rows.length, 0);
  for (const gone of ["squash", "auto", "trim", "newest"]) assert.equal((await runWith(r, { doc, turns, method: gone })).status, 400, `${gone} is no method`);
  turns = [];
  const nothing = await runWith(rig({ turns }), { doc, turns, method: "summary" });
  assert.deepEqual([nothing.status, nothing.error], [409, "summary: no finished turn to summarize"]);
});

// (fails before: yes — a compaction started no learning: its turns waited for the session to go idle)
test("each compaction written starts its learning run through memory, named by its trigger; the note and the op say what memory answered; nothing written, nothing learned (HarnessV3-Memory M7-D27)", async () => {
  const doc = settingsFor({});
  /** @type {any[]} */
  const asked = [];
  /** @type {any} */
  let answer = { learning: true, model: "house-cheap" };
  const compacted = (/** @type {string} */ chainId, /** @type {any} */ o) => (asked.push([chainId, o]), answer);
  const compactionOps = (/** @type {any} */ r) => r.recorded.filter((/** @type {any[]} */ x) => x[0] === "compaction");
  let turns = turnsOf(4);
  let r = rig({ turns, compacted });
  const fold = await runWith(r, { doc, turns, method: "fold", trigger: "line" });
  assert.deepEqual(asked, [["c1", { door: "line" }]], "the fold at the line: one run, by the line's door");
  assert.deepEqual(fold.learning, answer);
  assert.ok(fold.note.endsWith("; learning from them now on house-cheap"), fold.note);
  assert.equal(compactionOps(r)[0][2].detail.learning, "started");
  // A summary by hand, and memory saying why not.
  answer = { learning: false, why: "the session opted out of learning (memory.learn or privacy.learn is off)" };
  turns = turnsOf(3);
  r = rig({ turns, compacted });
  const summary = await runWith(r, { doc, turns, trigger: "manual" });
  assert.equal(summary.ok, true, summary.error);
  assert.deepEqual(asked.at(-1), ["c1", { door: "manual" }]);
  assert.deepEqual(summary.learning, answer);
  assert.ok(summary.note.endsWith(`; nothing learned from them now: ${answer.why}`), summary.note);
  assert.equal(compactionOps(r)[0][2].detail.learning, answer.why);
  // Nothing written: the summary failed, or a turn started meanwhile.
  const before = asked.length;
  r = rig({ turns, compacted, answer: async () => { throw new Error("the model is down"); } });
  assert.equal((await runWith(r, { doc, turns })).status, 502);
  r = rig({ turns, compacted });
  assert.equal((await runWith(r, { doc, turns, method: "fold", guard: () => "busy" })).status, 409);
  assert.equal((await runWith(r, { doc, turns, guard: () => "busy" })).status, 409);
  assert.equal(asked.length, before, "nothing written, nothing learned");
  // A memory with no learner door: no words, no detail.
  turns = turnsOf(3);
  r = rig({ turns });
  const plain = await runWith(r, { doc, turns, method: "fold" });
  assert.equal(plain.learning, null);
  assert.ok(!/learn/.test(plain.note), plain.note);
  assert.equal("learning" in compactionOps(r)[0][2].detail, false);
});

test("the settings read with their defaults and bounds; a summary's size is guessed from the session's own past summaries", () => {
  assert.deepEqual(compactionSettingsOf(null), { method: "summary", keepWhole: 1, writer: null, instantTokens: 20000, agent: "suggested", resumeQuestion: true, changeQuestion: true, follow: true });
  assert.deepEqual(compactionSettingsOf({ context: { compaction: { method: "fold", keepWhole: 99, writer: "model", instantTokens: -5, agent: "own", resumeQuestion: false, changeQuestion: false, follow: false } } }), { method: "fold", keepWhole: 10, writer: "model", instantTokens: 0, agent: "own", resumeQuestion: false, changeQuestion: false, follow: false });
  // Values no layer holds any more read as their defaults, with no conversion (the owner's rules of 10-31).
  const gone = compactionSettingsOf({ context: { compaction: { method: "trim", writer: "auto", target: 30 } } });
  assert.deepEqual([gone.method, gone.writer, "target" in gone, "tailPercent" in gone], ["summary", null, false, false]);
  assert.equal(compactionSettingsOf({ context: { compaction: { method: "auto" } } }).method, "summary");
  const odd = compactionSettingsOf({ context: { compaction: { method: "squash", writer: "nobody", agent: "nobody", resumeQuestion: "no" } } });
  assert.deepEqual([odd.method, odd.agent, odd.resumeQuestion], ["summary", "suggested", true]);
  assert.equal(summaryEstimate(100_000, []), 6000, "6% of what it condenses");
  assert.equal(summaryEstimate(1000, []), 1000, "never under 1,000");
  assert.equal(summaryEstimate(10_000_000, []), SUMMARY_ESTIMATE_CEILING, "never guessed over the estimate's ceiling");
  assert.equal(summaryEstimate(100_000, [{ text: "a ".repeat(400) }, { text: "b ".repeat(4000) }, { text: "c ".repeat(40) }]) > 0, true);
  // (fails before: yes — the owner's look of 10-24: the stand-in "summary " counted 1.5 tokens where 2 were meant, so a
  // guess of 6.5K weighed 4.9K in the plan)
  assert.deepEqual([6500, 1000].map((n) => estimateTokens(filler(n))), [6500, 1000], "a summary not yet written weighs what it is guessed at");
  // (fails before: yes — HarnessV4_Tasks C30 item 6: every summary the session ever had was opened for the guess) The
  // newest five with text say it, their median; an older one is never opened, a fold's row holds none.
  const opened = () => { throw new Error("an older summary was opened"); };
  const rows = [{ get text() { return opened(); } }, ...[400, 800, 1200, 1600, 2000].map((n) => ({ text: "w".repeat(n * 4) })), { text: null }];
  assert.equal(SUMMARY_ESTIMATE_PAST, 5);
  assert.equal(summaryEstimate(100_000, rows), estimateTokens("w".repeat(1200 * 4)), "the median of the newest five");
});

// ---- the three kinds (the owner's rules of 10-31) ---------------------------------------------------------------------

/**
 * A side model's compaction of four turns, each with a read whose result goes whole into the transcript: `budget` is
 * what one call of the side model reads at most (the slice ceiling stands in for its window), `instant` the instant
 * line. Whole, the four turns' transcript is about 1,160 tokens; folded, about 290; and the fold leaves about 2,030 of
 * the earlier turns.
 * @param {{ budget: number, instant?: number, writer?: string, sliceSummarize?: any, subagents?: any }} o
 */
const sideRun = async ({ budget, instant, writer = "model", sliceSummarize = null, subagents = null }) => {
  const turns = turnsOf(4);
  const doc = settingsFor({ context: { compaction: { writer, ...(instant != null ? { instantTokens: instant } : {}) } } });
  const r = rig({ turns, sliceConfig: { maxSliceTokens: budget }, sliceSummarize, subagents });
  const on = { chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 200_000, measure: measureFor(doc, 200_000) };
  const p = await r.compactor.plan(on);
  const out = await r.compactor.run({ ...on, trigger: "manual" });
  return { p, out: /** @type {any} */ (out), r, read: r.calls.map((c) => String(c.user)) };
};

// (fails before: yes — the side model's reading had no name in the plan, `reads` undefined)
test("the side model reads the turns whole where they fit one call of its window: their calls and results, one call", async () => {
  const { p, out, r, read } = await sideRun({ budget: 10_000 });
  assert.deepEqual([p.methods.summary.model, p.methods.summary.reads, p.methods.summary.slices], ["house-cheap", "whole", 1]);
  assert.deepEqual([out.ok, out.method, out.how, out.model], [true, "summary", "call", "house-cheap"]);
  assert.equal(read.length, 1);
  assert.ok(read[0].includes("contents of file 1"), "the tool results are read");
  assert.equal(r.rows[0].detail.folded, undefined);
});

// (fails before: yes — a side model whose turns did not fit one call read them whole all the same, in one call or in
// slices, and a fold that left the earlier turns small was never made in its place)
test("too big whole for the side model: the tool calls fold first, and folded turns at the instant line or under are an instant fold — no model call", async () => {
  const { p, out, r } = await sideRun({ budget: 1000 });
  assert.equal(p.methods.fold.instant, true, `the fold leaves ≈${p.methods.fold.earlier} of the earlier turns, under 20,000`);
  assert.deepEqual([p.methods.summary.reads, p.methods.summary.calls, p.methods.summary.cost, p.methods.summary.after], ["instant", 0, 0, p.methods.fold.after], "the plan says the fold's figures");
  assert.deepEqual([out.ok, out.method, out.how, out.model], [true, "fold", "local", null]);
  assert.equal(r.calls.length, 0, "no model called");
  assert.deepEqual(r.rows.map((x) => [x.method, x.summaryText, x.fromTurn, x.toTurn]), [["fold", null, 1, 3]], "the fold's row: turns 1–3, the newest kept whole");
  assert.match(out.note, /^compaction: turns 1–3 folded on request \(the side model's reading: the turns, their tool calls folded, leave ≈[\d,]+ tokens, within the 20,000 of an instant fold, so no model call\) — /);
});

// (fails before: yes — the side model read the turns whole, every result in its transcript)
test("over the instant line, the side model summarizes the folded copy in one call where it fits", async () => {
  const { p, out, r, read } = await sideRun({ budget: 1000, instant: 1000 });
  assert.equal(p.methods.fold.instant, false);
  assert.match(p.methods.fold.instantWhy, /^it leaves ≈[\d,]+ tokens of the earlier turns, over the 1,000 an instant fold may leave$/);
  assert.equal(p.methods.fold.possible, true, "a fold still runs where it is asked for by name: the line is the offer's");
  assert.deepEqual([p.methods.summary.reads, p.methods.summary.slices], ["folded", 1]);
  assert.ok(p.methods.summary.transcriptTokens < 1000, `the folded copy: ${p.methods.summary.transcriptTokens}`);
  assert.deepEqual([out.ok, out.how, out.model], [true, "call", "house-cheap"]);
  assert.equal(read.length, 1);
  assert.ok(read[0].includes("⚙ read f1.txt") && !read[0].includes("contents of file"), "one line per call, no tool output");
  assert.equal(r.rows[0].detail.folded, true);
  assert.match(out.note, /by house-cheap, from the turns with their tool calls folded \(too big whole for one call\)/);
});

// (fails before: yes — the slices read the turns whole)
test("still too big folded: the side model's last resort is slices, of the folded copy", async () => {
  /** @type {any[]} */
  const sliced = [];
  const { p, out } = await sideRun({ budget: 200, instant: 1000, sliceSummarize: async (/** @type {any} */ o) => (sliced.push(o), { text: "SLICED", calls: 2 }) });
  assert.equal(p.methods.summary.reads, "slices");
  assert.ok(p.methods.summary.slices > 1, String(p.methods.summary.slices));
  assert.deepEqual([out.ok, out.how], [true, "slices"]);
  assert.equal(sliced.length, 1);
  assert.ok(sliced[0].messages.every((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []).every((/** @type {any} */ b) => b.type === "text")), "words alone: no call, no result");
});

// (fails before: yes — the plan had no instant line; `instant` undefined)
test("the instant line is a setting: 20,000 tokens of the earlier turns by default, 0 for never; the same model never takes it", async () => {
  assert.equal(KNOBS["context.compaction.instantTokens"].default, 20000);
  const off = await sideRun({ budget: 1000, instant: 0 });
  assert.deepEqual([off.p.methods.fold.instant, off.p.methods.summary.reads, off.out.how], [false, "folded", "call"]);
  assert.match(off.p.methods.fold.instantWhy, /instant fold is off/);
  // The same model, too big whole: it reads the folded copy, and writes the summary — no fold in its place.
  const same = await sideRun({ budget: 1000, writer: "session" });
  assert.deepEqual([same.p.methods.fold.instant, same.p.methods.summary.model, same.p.methods.summary.reads], [true, "m", "folded"]);
  assert.deepEqual([same.out.method, same.out.how, same.out.model], ["summary", "call", "m"]);
  assert.ok(!same.read[0].includes("contents of file"));
});

// (fails before: yes — no recommendation: the plan named no kind for a warm cache or a cold one)
test("the plan weighs both writers side by side and recommends by the cache: the same model while it is warm and a fork has room, else the side model", async () => {
  const warm = { cacheOf: () => ({ state: "warm", leftMs: 120_000, tokens: 2000, model: "m", thinking: null }), forkCall: async () => ({ ok: true, text: "FORKED" }) };
  const hot = await sideRun({ budget: 10_000, writer: "session", subagents: warm });
  assert.equal(hot.p.recommended, "session");
  assert.deepEqual([hot.p.writers.session.model, hot.p.writers.session.reads, hot.p.writers.side.model, hot.p.writers.side.reads], ["m", "fork", "house-cheap", "whole"]);
  assert.equal(hot.out.how, "fork");
  const cold = await sideRun({ budget: 10_000, writer: "session" });
  assert.equal(cold.p.recommended, "model", "cold: the side model");
  assert.deepEqual([cold.p.writers.session.reads, cold.p.writers.session.possible], ["whole", true], "the same model can still write, reading it all again");
  // No side model to write: the same model, whatever the cache.
  const turns = turnsOf(3);
  const doc = settingsFor({});
  const alone = await rig({ turns, summarizer: "" }).compactor.plan({ chain: CHAIN, doc, turns, compactions: [], sessionModel: "m", window: 20000, measure: measureFor(doc, 20000) });
  assert.deepEqual([alone.recommended, alone.writers.side], ["session", null]);
});

// (fails before: yes — the refusal named Newest turns only, a way the owner's rules of 10-31 take away)
test("a summary refused for want of a model names the instant fold, which needs none, where it can run", async () => {
  const turns = turnsOf(4);
  const doc = settingsFor({ context: { compaction: { writer: "model" } } });
  const r = rig({ turns, summarizer: "" });
  const out = /** @type {any} */ (await runWith(r, { doc, turns, method: "summary" }));
  assert.deepEqual([out.ok, out.status], [false, 400]);
  assert.match(out.error, /^summary: no side model to summarize with: .* — Instant fold, newest 1 whole makes room with no model call$/);
});

// ---- the stored side: the head, the row's method, the words ----------------------------------------------------------

test("the head is the newest row with text; a fold row heads nothing; a compaction's words by its method", () => {
  const rows = [
    { from_turn: 1, to_turn: 4, kind: "plain", text: "S1" },
    { from_turn: 1, to_turn: 9, kind: "manual", method: "fold", text: null },
  ];
  assert.equal(compactionHead(rows).text, "S1");
  assert.equal(compactionHead([rows[1]]), null);
  assert.equal(compactionWords({ fromTurn: 1, toTurn: 4, method: "fold" }), "turns 1–4 folded");
  // (fails before: yes — the owner's rules of 10-31 took /trim: an old row of its reads as any summary does)
  assert.equal(compactionWords({ fromTurn: 1, toTurn: 4, method: "trim" }), "turns 1–4 compacted into one summary");
  assert.equal(compactionWords({ fromTurn: 1, toTurn: 4 }), "turns 1–4 compacted into one summary");
  // The slice pass as one summary text: no verbatim tail — the turns kept are real turns beside it.
  const joined = joinSlices({ digest: "D", slices: [{ n: 1, from: 1, to: 4, text: "A" }, { n: 2, from: 5, to: 9, text: "B", hollow: true }], missing: "2 turn group(s) could not be summarized." });
  assert.equal(joined, "## Earlier, condensed\nD\n\n## Part 1 — messages 1 to 4\nA\n\n## Part 2 — messages 5 to 9 (unusually short for its size — treat this part as incomplete; the originals are in Filament's archive)\nB\n\n## Not represented\n2 turn group(s) could not be summarized.");
  assert.equal(joinSlices({ digest: null, slices: [{ n: 1, from: 1, to: 2, text: "A" }] }), "## Part 1 — messages 1 to 2\nA");
});

const dir = mkdtempSync(join(tmpdir(), "filament-compactor-"));
const opened = [];
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});
let clock = 1_759_000_000_000;
const openArchive = (file) => {
  const a = new Archive({ file, now: () => (clock += 1000) });
  opened.push(a);
  return a;
};
const archivedTurn = (a, chainId, n) => {
  const { turnId } = a.beginTurn(chainId, { requestId: `r${n}`, model: "m", upstream: "u", userMessage: { role: "user", content: [{ type: "text", text: `turn ${n}` }] } });
  a.finishTurn(turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `done ${n}` }] }, requestId: `r${n}c` });
  return turnId;
};

// (fails before: yes — the compactions table had no method, and every row carried a summary message)
// (and fails before: yes — a row added without a method was written, its method null, for the readers to guess at)
test("compactions: every row names its method (one without is refused), a fold row with no text that marks its turns, a fork copies the method", () => {
  const b = openArchive(join(dir, "methods.db"));
  const chain = b.chainForKey("n:methods", { cwd: dir, client: "harness", model: "m" });
  assert.throws(() => b.addCompaction(chain.id, { fromTurn: 1, toTurn: 1, summaryText: "OLD", kind: "plain", window: "harness" }), /names its method/);
  assert.deepEqual(b.getCompactions(chain.id), [], "and nothing was written");
  b.addCompaction(chain.id, { fromTurn: 1, toTurn: 1, summaryText: "OLD", kind: "plain", window: "harness", method: "summary" });
  assert.deepEqual(b.getCompactions(chain.id).map((c) => [c.kind, c.method]), [["plain", "summary"]]);
  const ids = [1, 2, 3].map((n) => archivedTurn(b, chain.id, n));
  const { id, marked } = b.compactTurns(chain.id, { turnIds: ids.slice(0, 2), shape: "fold", kind: "manual", method: "fold", fromTurn: 1, toTurn: 2, window: "harness" });
  assert.equal(marked, 2);
  const row = b.getCompactions(chain.id).find((c) => c.id === id);
  assert.deepEqual({ method: row.method, kind: row.kind, summary_hash: row.summary_hash }, { method: "fold", kind: "manual", summary_hash: null });
  const bodies = b.turnBodies(chain.id);
  assert.deepEqual(bodies[0].meta.compacted, { shape: "fold", id, at: bodies[0].meta.compacted.at });
  assert.equal(bodies[2].meta.compacted, undefined);
  const s = b.addCompaction(chain.id, { fromTurn: 1, toTurn: 3, summaryText: "NEW", kind: "plain", window: "harness", method: "summary" });
  assert.ok(s.hash, "a summary row still carries its message");
  const fork = b.forkChain(chain.id, { atTurn: 3, key: "n:methods-fork" });
  assert.deepEqual(b.getCompactions(fork.id).map((c) => c.method), ["summary", "fold", "summary"]);
});

// (fails before: yes — rows had no detail, nothing could undo a compaction, and a fork kept marks naming its source's
// rows and dropped a fold row its cut ran through)
test("compactions: a row's detail; undo takes the row and its marks (a summary stays); a fork renames its marks and keeps the fold row the cut runs through", () => {
  const a = openArchive(join(dir, "detail.db"));
  const chain = a.chainForKey("n:detail", { cwd: dir, client: "harness", model: "m" });
  const ids = [1, 2, 3, 4, 5].map((n) => archivedTurn(a, chain.id, n));
  const fold = a.compactTurns(chain.id, { turnIds: ids.slice(0, 4), shape: "fold", kind: "manual", method: "fold", fromTurn: 1, toTurn: 4, window: "harness", detail: { before: 9000, after: 3000, model: null, how: "local" } });
  assert.deepEqual(a.getCompactions(chain.id)[0].detail, { before: 9000, after: 3000, model: null, how: "local" });
  assert.equal("detail_json" in a.getCompactions(chain.id)[0], false, "the stored JSON is read, not handed out raw");
  // The fork at turn 2 runs through the 1–4 fold: the row comes along clamped, and the marks name the fork's copy.
  const fork = a.forkChain(chain.id, { atTurn: 2, key: "n:detail-fork" });
  const frows = a.getCompactions(fork.id);
  assert.deepEqual(frows.map((c) => [c.from_turn, c.to_turn, c.method]), [[1, 2, "fold"]]);
  assert.deepEqual(a.turnBodies(fork.id).map((t) => t.meta.compacted?.id), [frows[0].id, frows[0].id]);
  assert.notEqual(frows[0].id, fold.id);
  // Undo in the source: the row and its four marks go; the learner's summary the turn carries stays.
  a.setTurnSummary(ids[0], "asked: 1");
  const undone = a.undoCompaction(chain.id, fold.id);
  assert.equal(undone.unmarked, 4);
  assert.equal(a.getCompactions(chain.id).length, 0);
  const after = a.turnBodies(chain.id);
  assert.deepEqual(after.map((t) => t.meta.compacted), [undefined, undefined, undefined, undefined, undefined]);
  assert.equal(after[0].summary, "asked: 1", "the summary is the turn's own");
  assert.equal(a.undoCompaction(chain.id, fold.id), null, "nothing left to undo");
  assert.deepEqual(a.turnBodies(fork.id).map((t) => t.meta.compacted?.shape), ["fold", "fold"], "the fork's marks are its own: untouched");
});
