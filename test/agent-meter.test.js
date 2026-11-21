// @ts-check
// HarnessV3-ACP AC3-5, with HarnessV3-AtHome AH-S1: the meter and the speed while a coding agent works. The agent's
// own count of its context becomes the run's `held` each time it moves — Claude's usage update, Codex's newest model
// call, the Cursor SDK's estimate at each call's end — and the meter's figure until the turn's record lands; the record
// keeps the agent's count and the window it named, with no verdict of Filament's; the widgets read them so, against the
// session's line on the agent's window (AC5-3), and itemise nothing the agent holds; after a compaction, what the
// agent holds then (AC5-8); the speed gauge reads every model's stream. Through the app, in acp-run.test.js; Codex's
// reader, in codex.test.js.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAgentRun } from "../src/app/agent-run.js";
import { heldFigure, windowFacts, windowFace, contextSources, windowParts, factsAfterCompaction, factsOfFreshStart } from "../src/ui/harness/widgets/context.js";
import { predictNextRead } from "../src/ui/harness/widgets/cache.js";
import { WIDGETS } from "../src/ui/harness/widgets/registry.js";
import { createSpeedMeter, speedNumber, speedWords, LEAST_MS, EASE_MS, PAUSE_MS, pausesWriting } from "../src/ui/harness/lib/speed.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";

/** @param {string} p */
const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the agent's count as it works (AC3-5)", () => {
  test("a count the agent reports is the run's `held` once each time it moves: the window it named, an estimate said so", () => {
    /** @type {any[]} */
    const events = [];
    const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 } });
    run.take({ type: "text", text: "Reading.", messageId: "m1" });
    run.take({ type: "usage", usage: { used: 12000, size: 200000 } });
    run.take({ type: "usage", usage: { used: 12000, size: 200000 } });
    run.take({ type: "usage", usage: { used: 0, size: 200000 } });
    run.take({ type: "usage", usage: { size: 200000 } });
    run.take({ type: "text", text: "Going on.", messageId: "m2" });
    run.take({ type: "usage", usage: { used: 15500.4 } });
    run.take({ type: "usage", usage: { used: 15500 }, estimated: true });
    assert.deepEqual(events.filter((e) => e.type === "held"), [
      { type: "held", round: 1, tokens: 12000, window: 200000, exact: true },
      { type: "held", round: 2, tokens: 15500, window: null, exact: true },
      { type: "held", round: 2, tokens: 15500, window: null, exact: false },
    ], "the same count again is nothing new; a count of nothing is no figure");
  });

  // (fails before: yes — the owner's report of 10-26: the Cache said the last turn's whole sum all through a running
  // turn, since nothing said a model call's own prompt before the turn's record landed)
  test("each model call of the agent's own is the run's `round-cache` once — Claude's raw message, Codex's report; a sub-agent's never — and the newest is the turn's", () => {
    /** @type {any[]} */
    const events = [];
    const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, rawMessages: true });
    const said = (/** @type {string} */ id, /** @type {any[]} */ content, /** @type {number[]} */ [input, read, wrote], parent = /** @type {string | null} */ (null)) =>
      run.take({ type: "raw", message: { type: "assistant", parent_tool_use_id: parent, message: { id, content, usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: wrote, output_tokens: 1 } } } });
    said("m1", [{ type: "thinking", thinking: "Where to start." }], [3, 0, 20_000]);
    said("m1", [{ type: "text", text: "Reading." }], [3, 0, 20_000]);
    said("s1", [{ type: "text", text: "A sub-agent's words." }], [5, 0, 9000], "toolu_task");
    said("m2", [{ type: "text", text: "Going on." }], [8, 20_000, 400]);
    assert.deepEqual(events.filter((e) => e.type === "round-cache"), [
      { type: "round-cache", round: 1, input: 3, cacheRead: 0, cacheWrite: 20_000 },
      { type: "round-cache", round: 2, input: 8, cacheRead: 20_000, cacheWrite: 400 },
    ], "each block of a call repeats its usage: said once; a sub-agent's call is its own");
    assert.deepEqual(run.lastModelCall(), { input: 8, cacheRead: 20_000, cacheWrite: 400 }, "the turn's newest call, for its record");
    /** @type {any[]} */
    const codexSaid = [];
    const codex = createAgentRun({ publish: (e) => codexSaid.push(e), sink: { breakBlock: () => 0 } });
    codex.take({ type: "text", text: "Looking." });
    codex.take({ type: "usage", usage: { used: 1240, size: 400_000 }, call: { input: 200, cacheRead: 1000, cacheWrite: 0 } });
    codex.take({ type: "usage", usage: { used: 1240, size: 400_000 }, call: { input: 200, cacheRead: 1000, cacheWrite: 0 } });
    assert.deepEqual(codexSaid.filter((e) => e.type === "round-cache"), [{ type: "round-cache", round: 1, input: 200, cacheRead: 1000, cacheWrite: 0 }], "Codex's report again is nothing new");
    assert.equal(createAgentRun({ publish: () => {}, sink: { breakBlock: () => 0 } }).lastModelCall(), null, "an agent that counts no call by itself: none");
  });

  // (fails before: yes — the owner's words of 10-29: Claude Code on a subscription writes an hour's cache, and the Cache
  // said five minutes, since nothing read the lifetime its own markers asked for)
  test("the lifetime the agent's own markers asked for rides on `round-cache`, as its provider split the call's writes; a call that only reads keeps the last one said", () => {
    /** @type {any[]} */
    const events = [];
    const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 }, rawMessages: true });
    const said = (/** @type {string} */ id, /** @type {any} */ usage) => run.take({ type: "raw", message: { type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text: id }], usage: { input_tokens: 3, output_tokens: 1, ...usage } } } });
    said("m0", { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    said("m1", { cache_read_input_tokens: 0, cache_creation_input_tokens: 20_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20_000 } });
    said("m2", { cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0 });
    said("m3", { cache_read_input_tokens: 20_000, cache_creation_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 50, ephemeral_1h_input_tokens: 0 } });
    assert.deepEqual(events.filter((e) => e.type === "round-cache").map((e) => e.ttlMs ?? null), [null, 3_600_000, 3_600_000, 300_000]);
  });
});

describe("the meter in a coding agent's session (AC3-5)", () => {
  // Filament reads a window from the model's name; the agent names its own.
  const view = { settings: { window: { tokens: 1_000_000, source: "catalog", model: "haiku" }, flat: { "context.compaction.thresholdPercent": 85 } } };
  const idle = { rec: null, usage: null, facts: null, liveOut: 0, estimate: 5000, streaming: false, agent: true, liveHeld: 0, liveOutBase: 0, liveWindow: null, liveExact: true };
  const working = { ...idle, streaming: true, liveOut: 900, liveHeld: 50_000, liveOutBase: 600, liveWindow: 200_000 };

  test("while the agent works its count is the figure, with what it wrote since; its window, and the session's line on it", () => {
    assert.deepEqual(heldFigure(working), { tokens: 50_300, known: true });
    assert.deepEqual(windowFacts(view, working), { window: 200_000, source: "agent", usable: null, verdict: null }, "the agent's window, not the one read from the name");
    const face = windowFace(view, working);
    assert.deepEqual([face.tokens, face.window, face.line, face.tone, face.text], [50_300, 200_000, { f: 0.85, tokens: 170_000, percent: 85 }, "", "≈25%"], "the line: 85% of the agent's window (AC5-3)");
    assert.deepEqual([120_000, 145_000, 170_000].map((liveHeld) => windowFace(view, { ...working, liveHeld }).tone), ["", "warn", "error"], "nearing the line warns; past it is an error, as in the loop's session");
    assert.notEqual(windowFace(view, { ...working, agent: false }).line, null, "the loop's session keeps its line");
    // (fails before: no — a guard the mutation pass asked for: no loop session's meter met a window an agent named)
    const moved = { ...idle, agent: false, rec: { context: { window: 200_000, source: "agent", usable: null, verdict: null, last: { held: 31_000 } } } };
    assert.deepEqual(windowFacts(view, moved), { window: 1_000_000, source: "catalog", usable: null, verdict: null }, "a session moved to the loop's model: its window, not the one the agent named");
    // Cursor's figure is Filament's estimate: ≈ as it works and after.
    assert.deepEqual(heldFigure({ ...working, liveExact: false }), { tokens: 50_300, known: true, estimated: true });
  });

  test("the turn's end: the record's count, not its billed sum; an estimate stays ≈; a window not named is Filament's", () => {
    const rec = { acp: { sessionId: "s" }, tokens: { input: 9000, cacheRead: 80_000, cacheWrite: 1000 }, context: { window: 200_000, source: "agent", usable: null, verdict: null, last: { held: 31_000 } } };
    assert.deepEqual(heldFigure({ ...idle, rec }), { tokens: 31_000, known: true }, "what the agent holds; the record's columns add up every call it made");
    assert.equal(windowFace(view, { ...idle, rec }).text, "16%");
    const cursor = { ...rec, context: { usable: null, verdict: null, last: { held: 4060, estimated: true } } };
    assert.deepEqual(heldFigure({ ...idle, rec: cursor }), { tokens: 4060, known: true, estimated: true });
    assert.deepEqual(windowFacts(view, { ...idle, rec: cursor }), { window: 1_000_000, source: "catalog", usable: null, verdict: null }, "no window named: the one Filament knows the model by");
    // (fails before: no — a guard the mutation pass asked for: no agent's record kept a window Filament had read)
    const read = { ...cursor, context: { ...cursor.context, window: 128_000, source: "catalog" } };
    assert.deepEqual(windowFacts(view, { ...idle, rec: read }), { window: 1_000_000, source: "catalog", usable: null, verdict: null }, "a window Filament read for the turn is not one the agent named");
    // "<1%" is a bound already: no "≈" in front of it (V4-D212).
    assert.equal(windowFace(view, { ...idle, rec: cursor }).text, "<1%");
    // After a reload the turn's facts say the same.
    const facts = { held: 90_000, context: { held: 4060, estimated: true, window: null, source: null, usable: null, verdict: null } };
    assert.deepEqual(heldFigure({ ...idle, facts }), { tokens: 4060, known: true, estimated: true });
  });

  test("after a compaction since its newest turn: its own, what the agent said it holds after, in its window; one of Filament's, the composition its fresh session starts from, an estimate (AC5-8)", () => {
    const own = factsAfterCompaction({ compactedSince: true, whole: 60_000, window: 1_000_000, usable: 850_000, agentHeld: { held: 18_000, window: 200_000 } });
    assert.deepEqual(own, { held: 18_000, context: { window: 200_000, usable: null, verdict: null, source: "agent" }, afterCompaction: true });
    assert.deepEqual([heldFigure({ ...idle, facts: own }), windowFacts(view, { ...idle, facts: own }).window], [{ tokens: 18_000, known: true }, 200_000]);
    const fresh = factsAfterCompaction({ compactedSince: true, whole: 60_000, window: 1_000_000, usable: 850_000, agentHeld: null });
    assert.deepEqual(fresh, { held: 60_000, context: { window: 1_000_000, usable: 850_000, verdict: null, source: null, estimated: true }, afterCompaction: true });
    assert.deepEqual(heldFigure({ ...idle, facts: fresh }), { tokens: 60_000, known: true, estimated: true });
    assert.deepEqual(factsAfterCompaction({ compactedSince: true, whole: 60_000, window: 1_000_000, usable: 850_000 })?.context, { window: 1_000_000, usable: 850_000, verdict: null, source: null }, "the loop's session: exact");
    assert.equal(factsAfterCompaction({ compactedSince: false, whole: 60_000, agentHeld: { held: 18_000 } }), null, "nothing compacted since");
  });

  // (fails before: yes — HarnessV4_Tasks U3-10: after a switch the ring kept the figure the agent that answered last
  // held, in that agent's window; nothing said the session's agent holds none of the chat)
  test("after a switch into an agent that holds none of the chat (U3-10): Filament's copy, which its fresh session starts from — an estimate, in the session's window", () => {
    const fresh = factsOfFreshStart({ freshStart: { why: "switch" }, whole: 42_000, window: 400_000, usable: 340_000 });
    assert.deepEqual(fresh, { held: 42_000, context: { window: 400_000, usable: 340_000, verdict: null, source: null, estimated: true }, freshStart: "switch" });
    assert.deepEqual(heldFigure({ ...idle, facts: fresh }), { tokens: 42_000, known: true, estimated: true });
    assert.equal(windowFacts(view, { ...idle, facts: fresh }).source !== "agent", true, "not a window the agent named: it has said nothing yet");
    assert.equal(factsOfFreshStart({ whole: 42_000, window: 400_000 }), null, "no switch: the newest turn's count stands");
    assert.equal(factsOfFreshStart({ freshStart: { why: "switch" }, whole: 0 }), null, "nothing weighed is no figure");
    assert.equal(factsOfFreshStart(null), null);
  });

  test("nothing counted yet is no figure: a draft is no measure of what the agent holds", () => {
    assert.deepEqual(heldFigure(idle), { tokens: 0, known: false });
    const face = windowFace(view, idle);
    assert.deepEqual([face.fill, face.text], [null, ""], "the hollow ring alone");
    assert.deepEqual(heldFigure({ ...idle, agent: false }), { tokens: 5000, known: false }, "the loop's draft is its estimate");
  });

  test("a coding agent's turn is not itemised: what Filament composed for it is not what the agent holds", () => {
    const composition = { userText: 8000, assistantText: 8000, toolUse: 0, toolResult: 0, thinking: 0, subagents: 0, system: 4000, tools: 30000 };
    const composed = { tokens: { input: 1000, cacheRead: 60000, cacheWrite: 3000 }, view: { historyTokens: 40000, shapedTokens: 40000, fixedTokens: 9000, composition } };
    assert.ok(contextSources(composed).rows.length > 0, "the loop's turn is itemised");
    const agentTurn = { ...composed, acp: { sessionId: "s" } };
    assert.deepEqual(contextSources(agentTurn), { rows: [], measured: false, reconciled: false, sysItemised: false, mismatch: null });
    assert.deepEqual(windowParts(agentTurn).parts, []);
    assert.match(source("src/ui/harness/panes/last-reply.js"), /r\.acp\n\s+\? "A coding agent's turn — the agent keeps its own context and reports it whole, so there are no parts to name\."/, "Run › Calls' record says why");
  });

  /** The popover's figure: the number and the tokens under it, how it is counted in its title. @param {any} el @returns {any} */
  const headOf = (el) => {
    if (!el || typeof el !== "object") return null;
    if (String(el.attrs?.class || "").split(/\s+/).includes("inst-meter-head")) return el;
    for (const k of el.kids || []) {
      const r = headOf(k);
      if (r) return r;
    }
    return null;
  };

  /** A widget context over live figures the test sets. @param {{ live: any }} state @param {string[]} [did] */
  const contextOf = (state, did = []) => /** @type {any} */ ({
    view: () => view,
    hasSession: () => true,
    live: () => state.live,
    turns: () => [],
    openPane: (/** @type {string} */ p) => did.push(`pane ${p}`),
    summon: () => did.push("summon"),
    openHow: () => did.push("how"),
    stopAndCompact: () => did.push("stop and compact"),
    dryRun: () => did.push("dry run"),
    scrollToTurn: () => true,
  });

  test("the Context popover in an agent's session: the whole as one fill, what the figure is, the room to its line; Compact now… waits while its turn runs (U3-2)", () => {
    const state = { live: /** @type {any} */ (working) };
    /** @type {string[]} */
    const did = [];
    const spec = WIDGETS.context(contextOf(state, did), { h: fakeH, drawIn: fakeDrawIn });
    const body = spec.panel?.(fakeH, () => did.push("closed"));
    let text = textOf(body);
    for (const bit of ["Haiku · 200K window", "50.3K of 200K", "Your line|170K · 85%", "120K before your line (170K). Your line acts between turns. The agent compacts by itself at its own point."])
      assert.ok(text.includes(bit), `${bit} — in ${text}`);
    // How the figure is counted is the figure's title (V4-D212).
    assert.equal(headOf(body).attrs.title, "The agent's own count as of its newest model call, and what it has written since. Its count at the turn's end replaces it.");
    // (fails before: yes — the donut's legend said the room to the line and that the whole is not itemised; the legend is
    // Filament's sessions' alone now, UX-7)
    assert.doesNotMatch(text, /Room to (the|your) line|reports its context whole/, "no legend in an agent's session");
    assert.equal(spec.title?.(), "Context: 50,300 of 200,000 tokens — 120K of room before compaction at 85%. — the agent's count as it works; its count at the turn's end replaces it");
    // The dry run and the map weigh Filament's composition, which the agent never reads. Its turn runs: it compacts its
    // own context as it works, so the card waits for the turn's end (U5 phase 3).
    // Beside your line, Makes room by names the session's way; Change… stands at the foot, hidden unless the person
    // may say the model's window (the design pass of 10-24).
    // Stop and compact beside it while the turn runs (the owner's of 11-09: the composer's ⌄ menu had it).
    assert.deepEqual(buttonsOf(body).map(textOf), ["170K · 85%", "Suggested", "Compact now…", "Stop and compact", "How earlier turns are kept", "Change…"]);
    buttonsOf(body)[2].dispatch("click");
    assert.deepEqual(did, [], "nothing while the agent's turn runs");
    // Past its line mid-turn, with no line handed: the line acts between turns, so Stop and compact (U2).
    state.live = { ...working, liveHeld: 175_000 };
    const past = spec.panel?.(fakeH, () => {});
    assert.ok(textOf(past).includes("Past your line (170K) mid-turn. It acts between turns; the agent compacts by itself at its own point."), textOf(past));
    assert.deepEqual(buttonsOf(past).map(textOf), ["170K · 85%", "Suggested", "Stop and compact", "How earlier turns are kept", "Change…"]);
    state.live = { ...working, agent: false };
    assert.deepEqual(buttonsOf(spec.panel?.(fakeH, () => {})).map(textOf), ["850K · 85%", "Same model", "Compact now…", "Stop and compact", "How earlier turns are kept", "Dry run", "Next request", "Change…"], "the loop's session keeps the dry run and the map");
    // The turn has begun, the agent has counted nothing of it yet: where its last turn ended.
    const rec = { acp: { sessionId: "s" }, tokens: { input: 9000, cacheRead: 80_000, cacheWrite: 1000 }, context: { window: 200_000, source: "agent", usable: null, verdict: null, last: { held: 31_000 } } };
    state.live = { ...working, rec, liveHeld: 0, liveWindow: null, liveOut: 300, liveOutBase: 0 };
    assert.equal(headOf(spec.panel?.(fakeH, () => {})).attrs.title, "Where the agent's last turn ended, and what it has written since — its count for this turn arrives as it works.");
    assert.match(String(spec.title?.()), / — where its last turn ended; its count for this turn arrives as it works$/);
    // Cursor's, the turn ended: an estimate, said so; the window Filament knows the model by.
    state.live = { ...idle, rec: { ...rec, context: { usable: null, verdict: null, last: { held: 4060, estimated: true } } } };
    assert.equal(headOf(spec.panel?.(fakeH, () => {})).attrs.title, "An estimate — this agent doesn't report its context, so Filament counts it from what it saw go in.");
    assert.match(String(spec.title?.()), /^Context: 4,060 of 1,000,000 tokens \(estimate\) — /);
    // Nothing counted: no figure, and the popover says when one comes.
    state.live = idle;
    text = textOf(spec.panel?.(fakeH, () => {}));
    for (const bit of ["Not counted yet|", "The agent counts its context after its first model call."]) assert.ok(text.includes(bit), `${bit} — in ${text}`);
    assert.doesNotMatch(text, /\|%\||0 of 1M|Room to (the|your) line/, "no share of the window to say, nor room to the line");
    // (fails before: no — a guard the mutation pass asked for: the popover's room words were never read before a count)
    assert.doesNotMatch(text, /left in the window/, "nor any room in it");
    assert.deepEqual([spec.marks?.().hollow, spec.state()], [true, ""], "the pill's ring hollow, no figure");
    assert.equal(spec.title?.(), "Context: nothing counted yet — the agent counts its context after its first model call");
  });

  // (fails before: yes — after Codex's own compaction, which names no figure after it, the meter read Filament's
  // composition as an estimate of a fresh session the agent never starts)
  test("after its own compaction that named no figure after it (Codex's): no figure, in its window; it counts again at its next turn", () => {
    const unsaid = factsAfterCompaction({ compactedSince: true, whole: 60_000, window: 1_000_000, usable: 850_000, agentHeld: { held: null, window: 380_000 } });
    assert.deepEqual(unsaid, { held: 0, context: { window: 380_000, usable: null, verdict: null, source: "agent" }, afterCompaction: true, unsaid: true });
    const live = { ...idle, facts: unsaid };
    assert.deepEqual([heldFigure(live), windowFacts(view, live).window], [{ tokens: 0, known: false }, 380_000]);
    const spec = WIDGETS.context(contextOf({ live }), { h: fakeH, drawIn: fakeDrawIn });
    const text = textOf(spec.panel?.(fakeH, () => {}));
    for (const bit of ["Not counted yet|", "The agent compacted its context and didn't say what it holds now — it counts again at its next turn."]) assert.ok(text.includes(bit), `${bit} — in ${text}`);
    assert.equal(spec.title?.(), "Context: not counted since the agent's compaction — it counts again at its next turn");
  });

  test("the cache in an agent's session: what it holds carries over; Filament's compaction line never speaks for the agent", async () => {
    assert.deepEqual(predictNextRead({ carried: 0.9, agent: true }), { share: 0.9, words: "The agent keeps its conversation whole between turns, so what the cache holds now carries over — unless the agent compacts first." });
    assert.equal(predictNextRead({ carried: 0.9, cold: true, agent: true }).share, 0, "an expired cache is expired for an agent too");
    // The agent's newest call as its run said it, its writes' lifetime with it (`round-cache`'s `ttlMs`): the cache
    // has a clock, and so a prediction.
    const live = { agent: true, streaming: false, rec: { tokens: { input: 2000, cacheRead: 45_000, cacheWrite: 3000 } }, call: { input: 2000, cacheRead: 45_000, cacheWrite: 3000, at: Date.now() - 60_000, ttlMs: 300_000 } };
    const pv = { current: { wouldCompact: true }, compaction: { agent: { over: false } } };
    const ctx = /** @type {any} */ ({
      view: () => ({ settings: { usage: null } }),
      hasSession: () => true,
      live: () => live,
      turns: () => [],
      preview: async () => pv,
      subagents: { cache: () => ({ state: "warm", leftMs: 240_000, ttlMs: 300_000, tokens: 0 }) },
    });
    const drawn = async () => {
      const body = WIDGETS.cache(ctx, { h: fakeH, drawIn: fakeDrawIn }).panel?.(fakeH, () => {});
      await new Promise((r) => setImmediate(r));
      return textOf(body);
    };
    const text = await drawn();
    assert.ok(text.includes("unless the agent compacts first"), text);
    assert.doesNotMatch(text, /crosses the compaction line/, "Filament's composition past its line is not the agent's");
    pv.compaction.agent.over = true;
    assert.match(await drawn(), /crosses the compaction line/, "the agent past its own line (AC5-3)");
    live.agent = false;
    assert.match(await drawn(), /crosses the compaction line/, "the loop's session: the compose preview's line speaks");
  });
});

describe("the speed gauge (AH-S1)", () => {
  test("the rate over the last few seconds while the reply writes, its average over the time it wrote; a pause is no writing", () => {
    const m = createSpeedMeter();
    /** The figures, the eased one aside (its own test below). @param {number} now */
    const fig = (now) => { const { shown: _, ...r } = m.read(now); return r; };
    // 40 characters every 100 ms: 100 tokens a second.
    for (let t = 0; t <= 1000; t += 100) m.sample(t, 40 * (t / 100 + 1));
    assert.deepEqual(fig(1000), { live: true, rate: 100, average: 100, tokens: 110, writingMs: 1000, settled: false });
    // Twice as fast for the next three seconds: the rate is the window's, the last three seconds once they are all fast.
    for (let t = 1100; t <= 4000; t += 100) m.sample(t, 440 + 80 * ((t - 1000) / 100));
    assert.deepEqual(fig(4000), { live: true, rate: 200, average: 175, tokens: 710, writingMs: 4000, settled: false });
    // The stream stops: still writing for a pause's length — a provider's next burst may come — then not; the average stands.
    assert.deepEqual([fig(4000 + PAUSE_MS).rate, fig(4001 + PAUSE_MS).rate, fig(4001 + PAUSE_MS).average], [200, null, 175]);
    // A tool ran for five seconds: no writing time, and the words after it start a stretch of their own.
    m.sample(9000, 3240);
    assert.deepEqual(fig(9000), { live: false, rate: null, average: 175, tokens: 810, writingMs: 4000, settled: false }, "one sample is no rate yet");
    for (let t = 9100; t <= 9500; t += 100) m.sample(t, 3240 + 40 * ((t - 9000) / 100));
    const at = fig(9500);
    assert.deepEqual([at.live, at.rate, Math.round(/** @type {number} */ (at.average)), at.tokens, at.writingMs], [true, 100, 167, 860, 4500]);
    m.sample(9600, 3440);
    assert.equal(fig(9600).writingMs, 4500, "a redraw of the same words is nothing new");
    const end = /** @type {any} */ (m.settle());
    assert.deepEqual([end.live, end.rate, end.shown, end.settled], [false, null, end.average, true], "the reply ended: its average, shown whole");
  });

  // (fails before: yes — a gap past 1.5 s was a pause, so a provider's bursts some two seconds apart were never
  // writing: the gauge said no figure for GLM 5.3 from its first word to its last; HarnessV4_Artifacts_Plan AFC-158)
  test("words sent in bursts some two seconds apart are writing; where the run says its tools start, the writing stops", () => {
    const m = createSpeedMeter();
    // Z.AI's GLM, as measured: about 380 characters (95 tokens) at once, every 2.2 seconds.
    for (let i = 0; i < 5; i++) m.sample(i * 2200, 380 * (i + 1));
    const r = m.read(4 * 2200);
    assert.deepEqual([r.live, Math.round(/** @type {number} */ (r.rate)), Math.round(/** @type {number} */ (r.average)), r.writingMs], [true, 43, 43, 4 * 2200]);
    // (fails before: yes — the owner's report of 10-27: between bursts the gauge fell to the average, muted, and snapped back)
    const between = m.read(4 * 2200 + 1500);
    assert.deepEqual([between.live, Math.round(/** @type {number} */ (between.rate)), Math.round(/** @type {number} */ (between.shown))], [true, 43, 43], "between bursts, the reply is still writing at its rate");
    // The round's tools start: the time they take, and the next round's wait for its first word, are no writing.
    m.pause();
    assert.deepEqual([m.read(9000).rate, Math.round(/** @type {number} */ (m.read(9000).average))], [null, 43]);
    m.sample(11000, 2300);
    assert.equal(m.read(11000).writingMs, 4 * 2200, "the words after it start a stretch of their own");
    m.sample(13200, 2680);
    assert.equal(m.read(13200).writingMs, 5 * 2200);
    // A gap longer than four seconds inside a reply is a pause all the same.
    m.sample(17300, 3000);
    assert.equal(m.read(17300).writingMs, 5 * 2200);
    m.sample(17500, 3080);
    assert.equal(m.read(17500).writingMs, 5 * 2200 + 200);
    m.pause();
    m.sample(17600, 3080);
    m.sample(18000, 3160);
    assert.equal(m.read(18000).writingMs, 5 * 2200 + 200, "a redraw after a pause is nothing new: the words after it start");
  });

  // (fails before: yes — the owner's report of 10-27: on an Anthropic key the gauge hardly moved while the turn ran, its
  // rounds thinking where the stream shows none of it and writing calls, never words; the meter had no round's count)
  test("each round's own count is the figure as it comes: a round that streamed no words still moves the average", () => {
    const m = createSpeedMeter();
    // Round 1 streams 400 characters (about 100 tokens) over a second, then its count says it wrote 300 in 2 s.
    for (let t = 0; t <= 1000; t += 100) m.sample(t, 40 * (t / 100 + 1));
    m.wrote(300, 2000);
    assert.deepEqual([m.read(1000).average, m.read(1000).tokens, m.read(1000).writingMs], [150, 300, 2000]);
    // Round 2 streams nothing at all (thinking, a call): its count alone moves the figure.
    m.pause();
    m.wrote(500, 2000);
    assert.deepEqual([m.read(5000).rate, m.read(5000).average, m.read(5000).tokens, m.read(5000).writingMs], [null, 200, 800, 4000]);
    // Round 3's words before their count are the estimate's, on top of the counted rounds.
    for (let t = 6000; t <= 6500; t += 100) m.sample(t, 440 + 40 * ((t - 6000) / 100 + 1));
    assert.deepEqual([m.read(6500).live, m.read(6500).average, m.read(6500).tokens], [true, 200, 860]);
    // A count too short to time adds its tokens, not to the average.
    m.wrote(60, null);
    assert.deepEqual([m.read(7000).average, m.read(7000).tokens], [200, 860]);
    assert.deepEqual(m.settle(), { live: false, rate: null, average: 200, shown: 200, tokens: 860, writingMs: 4000, settled: true });
  });

  // (fails before: yes — the owner's report of 10-27: "it rarely updates … not like some jerky snapping numbers"; the
  // figure jumped to each new reading, and only when a piece of the stream came)
  test("the figure shown eases toward the measure as time passes, never snapping; a reply's end shows its average whole", () => {
    const m = createSpeedMeter();
    for (let t = 0; t <= 1000; t += 100) m.sample(t, 40 * (t / 100 + 1));
    assert.equal(m.read(1000).shown, 100, "the first figure is the measure itself");
    // The model writes four times as fast for three seconds: the rate jumps, the figure follows it over time.
    for (let t = 1100; t <= 4000; t += 100) m.sample(t, 440 + 160 * ((t - 1000) / 100));
    const at = (/** @type {number} */ now) => /** @type {number} */ (m.read(now).shown);
    const rate = /** @type {number} */ (m.read(4000).rate);
    assert.equal(rate, 400);
    const steps = [at(4000 + 100), at(4000 + 300), at(4000 + EASE_MS + 300), at(4000 + 5 * EASE_MS)];
    assert.ok(steps.every((v, i) => v > 100 && v < rate && (i === 0 || v > steps[i - 1])), "climbing, never there at once: " + steps.join(", "));
    assert.ok(rate - steps[3] < 10, "and close after a few eases: " + steps[3]);
    assert.equal(at(4000 + 5 * EASE_MS), steps[3], "read again at the same moment, it holds");
  });

  test("too little writing says no figure; the number reads whole, to a tenth below ten", () => {
    const m = createSpeedMeter();
    m.sample(0, 100);
    m.sample(LEAST_MS - 50, 200);
    const r = m.read(LEAST_MS - 50);
    assert.deepEqual([r.rate, r.average, m.settle()], [null, null, null]);
    assert.deepEqual([0.04, 3.14, 9.96, 10, 42.4, 120.6].map(speedNumber), ["0", "3.1", "10", "10", "42", "121"]);
    assert.equal(speedWords(42.4), "42 tok/s");
  });

  test("the Speed pill: the rate while the model writes; between words this reply's average, muted; then the last reply's", () => {
    const state = /** @type {any} */ ({ live: { streaming: false, speed: null } });
    const spec = WIDGETS.speed(/** @type {any} */ ({ live: () => state.live }), { h: fakeH, drawIn: fakeDrawIn });
    assert.deepEqual([spec.visible?.(), spec.state(), spec.title?.()], [false, "", "Speed: no reply yet"], "nothing before a reply has streamed");
    state.live = { streaming: true, speed: { live: true, rate: 52.3, average: 48.2, tokens: 300, writingMs: 2400, settled: false } };
    assert.deepEqual([spec.visible?.(), spec.state(), spec.marks?.().still, spec.title?.()], [true, "52 tok/s", false, "Speed: 52 tok/s over the last few seconds — the model is writing"]);
    let text = textOf(spec.panel?.(fakeH, () => {}));
    for (const bit of ["Speed", "Writing now", "52", "tok/s", "Over the last few seconds", "Written", "This reply so far", "300 tokens", "Average", "Over 2.4 s of writing", "48 tok/s", "a gap longer than 4 s isn't writing time"])
      assert.ok(text.includes(bit), `${bit} — in ${text}`);
    state.live = { streaming: true, speed: { ...state.live.speed, live: false, rate: null } };
    assert.deepEqual([spec.state(), spec.marks?.().still, spec.title?.()], ["48 tok/s", true, "Speed: this reply's average so far, 48 tok/s — it isn't writing this moment"]);
    text = textOf(spec.panel?.(fakeH, () => {}));
    for (const bit of ["This reply, between words", "Its average so far, while it wrote", "This reply so far"]) assert.ok(text.includes(bit), `${bit} — in ${text}`);
    state.live = { streaming: false, speed: { ...state.live.speed, settled: true } };
    assert.deepEqual([spec.state(), spec.marks?.().still, spec.title?.()], ["48 tok/s", true, "Speed: the last reply wrote 48 tok/s on average"]);
    text = textOf(spec.panel?.(fakeH, () => {}));
    for (const bit of ["The last reply", "The reply's average, while it wrote"]) assert.ok(text.includes(bit), `${bit} — in ${text}`);
    // A new reply streams before it has a figure of its own: the last reply's, said as the last reply's.
    state.live = { streaming: true, speed: state.live.speed };
    assert.equal(spec.title?.(), "Speed: the last reply wrote 48 tok/s on average");
    // The eased figure is the one drawn while it writes.
    state.live = { streaming: true, speed: { live: true, rate: 52.3, average: 48.2, shown: 50.6, tokens: 300, writingMs: 2400, settled: false } };
    assert.equal(spec.state(), "51 tok/s");
    state.live = { streaming: false, speed: { ...state.live.speed, live: false, rate: null, shown: undefined, settled: true } };
    // (fails before: no — a guard the mutation pass asked for: no figure kept a rate once its stream had ended)
    state.live = { streaming: false, speed: { ...state.live.speed, rate: 52.3 } };
    assert.deepEqual([spec.state(), spec.marks?.().still], ["48 tok/s", true], "the stream over, a rate still in hand is no writing");
  });

  test("the page: each turn keeps its own figures; the meter and the gauge are the shown chat's; a command keeps the speed before it", () => {
    const app = source("src/ui/harness/app.js");
    assert.match(app, /else if \(e\?\.type === "held" && Number\(e\.tokens\) > 0\) live\.meter = \{ tokens: Number\(e\.tokens\), window: e\.window \?\? null, exact: e\.exact !== false, base: live\.out \|\| 0 \};/);
    assert.doesNotMatch(app, /\blive\.held = /, "the meter's figure never takes the place of the messages the turn holds (`live.held`)");
    assert.match(app, /paintMeter\(chat\);\n {2}if \(chat\.live\) meterBack\(chat\.live\);\n {2}paintSpeed\(chat\);/, "a chat shown again: its meter, a running turn's own figures, its gauge");
    // Each model call's prompt is kept on its chat, past the turn's end, and is the Cache's last request where it shows.
    assert.match(app, /if \(e\?\.type === "round-cache"\) \{\n\s+const call = callOf\(e\);\n\s+if \(!call\) return;\n\s+chat\.lastCall = call;\n\s+if \(chatOf\(state\.currentId\) === chat\) composer\.setCall\(call\);\n\s+return;\n\s+\}/);
    assert.match(app, /composer\.setRecord\(rec, [^\n]+\);\n {2}composer\.setCall\(chat\.lastCall \|\| null\);/, "a chat shown again: its own newest call, never another chat's");
    // Each round's own count reaches the gauge as it comes, after the words it streamed are measured.
    assert.match(app, /if \(e\?\.type === "round-written"\) \{\n[^\n]+\n\s+measureNow\(chat, live\);\n\s+live\.speed\.wrote\(Number\(e\.output\) \|\| 0, [^\n]+\);\n\s+paintSpeed\(chat\);/);
    assert.equal((app.match(/measureReply\(chat, live\);/g) || []).length, 3, "the sending page's stream and a followed turn's alike, and the calls a round writes");
    // (fails before: yes — the owner's report of 10-27: the gauge stood still while an agent wrote a file — a call's input
    // never reached the page — and was drawn only when a piece of the stream came)
    assert.match(app, /if \(e\?\.type === "round-writing"\) \{\n\s+\(live\.callChars \|\|= \{\}\)\[String\(e\.round\)\] = Number\(e\.chars\) \|\| 0;\n\s+measureReply\(chat, live\);/);
    assert.match(app, /const chars = calls \+ \(live\.reply\?\.blocks/, "the calls' input counts with the words and thinking");
    assert.match(app, /live\.speedTick = setTimeout\(\(\) => \{\n\s+live\.speedTick = 0;\n\s+if \(chat\.live === live\) paintSpeed\(chat\);\n\s+\}, SPEED_TICK_MS\);/, "drawn again on its own while the reply runs");
    assert.match(app, /settleSpeed\(chat, live, !turn\.command\);/);
    assert.match(app, /settleSpeed\(chat, live, !newestOnRecord\(chat\.turns\)\?\.command\);/);
    assert.match(app, /if \(chatOf\(state\.currentId\) !== chat\) return;\n {2}const live = chat\.live;\n {2}const now = live\?\.speed\?\.read\(Date\.now\(\)\) \|\| null;/, "only the shown chat's gauge is painted");
    // A model the catalogue does not list (an alias, a name set by a command): a coding agent's by the server's answer.
    const composer = source("src/ui/harness/composer/composer.js");
    assert.match(composer, /const coder = !!viewSettings\?\.engine\?\.coder && !!inForce && \(effortLane\(inForce\)\?\.base \|\| inForce\) === raw;\n\s+modelIsAgent = coder \|\| modelRows\.some/);
  });
});

// (fails before: yes — the Hunter's find of 10-27: only a round's tools and its next round stopped the writing, so the
// wait before a try asked again counted as writing time: 500 characters after a one-second wait read as 125 tok/s)
test("a wait between a call's tries is no writing: the gauge's next words start a stretch of their own", () => {
  const waiting = { type: "turn-state", from: "calling", to: "waiting", why: "502 — trying again in 1 s", retry: { status: 502, waitMs: 1000 } };
  assert.equal(pausesWriting(waiting), true);
  assert.equal(pausesWriting({ type: "turn-state", from: "waiting", to: "calling" }), false, "the next try writes again");
  assert.equal(pausesWriting({ type: "tool-start" }), true);
  assert.equal(pausesWriting({ type: "round-start" }), true);
  assert.equal(pausesWriting({ type: "round-writing", chars: 10 }), false);
  /** The page's meter through one broken try and the next. @param {boolean} heard */
  const through = (heard) => {
    const m = createSpeedMeter();
    m.sample(10_000, 3000);
    m.sample(10_300, 3200);
    if (heard && pausesWriting(waiting)) m.pause();
    m.sample(11_300, 3700);
    return m.read(11_300);
  };
  assert.equal(through(true).writingMs, 300, "the second's wait is not writing");
  assert.equal(through(false).writingMs, 1300, "unheard, it was");
});
