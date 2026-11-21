// @ts-check
// HarnessV3 Step 4 (Context, end to end): one compaction home, auto-fit decided per session on both doors, the window
// of the model in force from the server, the run card's and the live turn's words, and the widget system — a registry,
// a layout, and one context object. The widget half runs without a DOM (the recording h); the auto-fit half runs the
// live app against a fake provider, the way an outside client's chat reaches it.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { KNOBS } from "../src/services/session-settings.js";
import { usableWindow, roundsHead, roundsLead, ROUNDS_LINE, COMPACTION_SYSTEM } from "../src/app/sessions/compaction.js";
import { compactionWords, stationsFrom, windowLine } from "../src/ui/harness/panes/run.js";
import { turnStateWords, windowSourceWords, verdictWords } from "../src/ui/harness/lib/labels.js";
import { WIDGETS, DEFAULT_LAYOUT, TILES, widgetsFor } from "../src/ui/harness/widgets/registry.js";
import { mountWidgets } from "../src/ui/harness/widgets/host.js";
import { windowFacts, compactionLine, windowParts } from "../src/ui/harness/widgets/context.js";
import { LINE_MIN, LINE_MAX, standing, isClientView } from "../src/ui/harness/widgets/compaction.js";
import { howSection } from "../src/ui/harness/panes/context-how.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf, recordingPopover } from "./helpers/fake-dom.js";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";
import { autofit as autofitStage } from "../src/app/pipeline/stages/autofit.js";
import { derivedOf } from "../src/ui/lib/settings/editor.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ p) => readFileSync(join(ROOT, p), "utf8");

// ---------------------------------------------------------------------------------------------------
// The owners (D1–D3, D7)
// ---------------------------------------------------------------------------------------------------

describe("Step 4: the owners", () => {
  // (fails before: yes — the ladder had a per-session policy knob; 2026-09-28 the ladder itself left the request path)
  test("the fit is a command, not a policy: no session knob switches any request reshaping on", () => {
    assert.equal(KNOBS["context.autofit.enabled"], undefined, "the auto-fit switch is gone — nothing rewrites a request between a client and its provider");
    assert.equal(KNOBS["context.autofit.overflow"], undefined, "and so is its ladder-depth knob");
  });
  // (fails before: yes — the formula lived in compose.js and the agent turn, twice)
  // (fails before: yes — the stage stamped session turns with the native reserve formula, so the meter's line and
  // the composer's line were two different numbers)
  test("the context-fit stage stamps a session's turn with the composer's own line; a native request keeps its reserve", async () => {
    const cfg = () => ({
      upstreams: [{ id: "u", pricing: { m: { input: 1, output: 1, contextTokens: 20000 } } }],
      routes: [],
      rules: {},
    });
    const round = (pre, maxTokens = 32000) => {
      const rec = {};
      const ctx = { body: { model: "m", max_tokens: maxTokens, system: "s", messages: [{ role: "user", content: "hi" }] }, pre, rec, route: { upstream: "u", upstreamModel: "m", captures: [] }, requested: { base: "m" }, candidates: [{ upstream: "u", upstreamModel: "m" }] };
      return autofitStage(/** @type {any} */ (ctx), /** @type {any} */ ({ config: cfg })).then(() => rec);
    };
    const sessionRec = await round({ api: "session", composition: { usable: 17000, window: 20000, sentTokens: 12000 } });
    assert.equal(sessionRec.context.window, 20000);
    assert.equal(sessionRec.context.usable, 17000, "the composer's compaction line, not window minus the reserve");
    const nativeRec = await round({ api: "anthropic", body: {}, responsesBody: null }, 8000);
    assert.equal(nativeRec.context.usable, 20000 - (Math.min(8000, 32000) + 4096), "a native request: the window minus its own reply ask and head-room");
  });

  test("derivedOf: the session view's derived list as the knob rows read it (Step 6 \u00a71.4)", () => {
    const d = [{ path: "model.thinking.keepInHistory", value: true, why: "thinking is on and this model keeps its thinking", note: undefined }];
    assert.deepEqual(derivedOf({ derived: d }), { "model.thinking.keepInHistory": d[0] });
    assert.deepEqual(derivedOf({}), {}, "no derivations, no map");
    assert.deepEqual(derivedOf(null), {});
    // The badge itself: a derived knob under a default source renders "derived on", the why on its tooltip.
    const editor = read("src/ui/lib/settings/editor.js");
    assert.match(editor, /src-derived/, "the derived badge has its own class");
    assert.match(editor, /An explicit choice here always wins over the derivation/, "the tooltip says how to override");
  });

  test("usableWindow is the one formula: your percentage of the real window, never under 1,000 (D7, Step 6)", () => {
    assert.equal(usableWindow(256_000, { thresholdPercent: 85 }), Math.floor(256_000 * 0.85));
    assert.equal(usableWindow(256_000, {}), Math.floor(256_000 * 0.85), "the default threshold is 85");
    assert.equal(usableWindow(20_000, { thresholdPercent: 4 }), 1_000, "a threshold below the knob's floor still leaves 1,000");
    assert.equal(usableWindow(20_000, { thresholdPercent: 100 }), 20_000, "at 100 the line is the window itself");
    // One place computes it: every other use calls this function (the ui has its own words, not this rule).
    const files = [];
    const walk = (/** @type {string} */ dir) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (p !== "src/ui") walk(p); } else if (p.endsWith(".js")) files.push(p);
      }
    };
    walk("src");
    const formula = files.filter((f) => /window \* \(pct \/ 100\)/.test(read(f)));
    assert.deepEqual(formula, ["src/app/sessions/compaction.js"], "the compaction line has one owner");
    for (const f of ["src/app/sessions/compose.js", "src/app/agent/turn.js"]) assert.match(read(f), /usableWindow\(/, `${f} calls the owner`);
  });

  // (fails before: yes — the loop built its head inline)
  test("the loop's fold head is roundsHead of roundsLead: the model's line, then the summary (D7; its words since HarnessV3-AtHome AH-D9 c)", () => {
    assert.deepEqual(roundsHead(roundsLead(2, 5, "the summary")), [
      { role: "assistant", content: [{ type: "text", text: ROUNDS_LINE }] },
      { role: "user", content: [{ type: "text", text: "[Filament compacted rounds 2–5 of this turn into the summary below. Carry on from it where the work stands, without recapping it.]\nthe summary" }] },
    ]);
    // The lead is made once: the fold weighs the bare head with it (what the fold frees) before the head goes in.
    const loop = read("src/app/agent/loop.js");
    assert.ok(loop.includes("const lead = roundsLead(workFirst, toRound, summary);"), "the loop builds its head through the owners");
    // What came back, and since HarnessV4_Envelopes_Plan EN2 the envelopes still sealed after it (envelopes-loop.test.js).
    assert.ok(loop.includes("convo.splice(workFrom, upTo - workFrom, ...roundsHead(lead, comesBack || null));"), "and puts it in whole: the lead, then what came back");
    // Composed as a compaction's checkpoint (checkpoint.js): the block that came back, then the sealed list.
    assert.ok(loop.includes('const comesBack = [back?.text || "", backNow.blocks.find((b) => b.id === "sealed")?.text || ""].filter(Boolean).join("\\n\\n");'), "what came back is the reattached files, plan and graph, then the sealed list");
  });
});

// ---------------------------------------------------------------------------------------------------
// The words (D5, D6)
// ---------------------------------------------------------------------------------------------------

describe("Step 4: the run card's, the live turn's and the window's words", () => {
  // (fails before: yes — the three shapes printed "rounds undefined–undefined")
  test("compactionWords says each of the loop's three compaction shapes in a sentence, never undefined (D6)", () => {
    const rounds = compactionWords({ type: "compaction", fromRound: 3, toRound: 7, tokensBefore: 180_000, tokensAfter: 22_000 });
    assert.equal(rounds, "Compacted rounds 3–7 into a summary (~180k → ~22k tok).");
    // HarnessV3-Compaction Phase 1b: a summary the fork wrote from the loop's warm cache says so.
    assert.equal(compactionWords({ type: "compaction", fromRound: 3, toRound: 7, tokensBefore: 180_000, tokensAfter: 22_000, fork: true }), "Compacted rounds 3–7 into a summary written from the warm cache (~180k → ~22k tok).");
    assert.match(compactionWords({ type: "compaction", stoodDown: true }), /standing down for the rest of this turn/);
    assert.equal(compactionWords({ type: "compaction", why: "overflow-refusal", cleared: 4, folded: true }), "The provider refused a round for size — retried once after clearing 4 old tool results and summarizing the oldest rounds into one.");
    assert.equal(compactionWords({ type: "compaction", why: "overflow-refusal" }), "The provider refused a round for size — retried once, with nothing to clear or summarize.");
    for (const e of [{ stoodDown: true }, { why: "overflow-refusal", cleared: 1 }, { fromRound: 1, toRound: 2, tokensBefore: 5000, tokensAfter: 1000 }])
      assert.equal(/undefined|NaN/.test(compactionWords(e)), false, JSON.stringify(e));
  });

  // (fails before: yes — a Compact that folded nothing read "Compacted rounds undefined–undefined into a summary
  // (~1k → ~1k tok)." in the Run pane, and counted as a compaction)
  test("a Compact that folded nothing says so in the Run pane, and is no compaction in its figures", () => {
    assert.equal(compactionWords({ type: "compaction", round: 2, manual: true, result: "little" }), "Compact asked — this turn has too little finished work to summarize yet; nothing was summarized.");
    assert.equal(compactionWords({ type: "compaction", round: 2, manual: true, result: "empty" }), "Compact asked — the summarizer came back empty, so nothing was summarized.");
    const view = stationsFrom([{ type: "round-start", round: 1 }, { type: "compaction", round: 1, manual: true, result: "little" }]);
    assert.deepEqual([view.rounds[0].bodies.map((/** @type {any} */ b) => b.kind), view.metrics.compactions], [["folding"], 0]);
  });

  test("the window line: its size, where the number came from, the compaction line (D6)", () => {
    assert.equal(windowLine({ window: 256_000, source: "endpoint", usable: 197_000 }), "Window 256k — from the provider's model list · compacts 197k");
    assert.equal(windowLine({ window: null }), "Window unknown for this model — the window machinery stands down.");
  });

  // (fails before: yes — the live fold said nothing but the timer)
  test("turnStateWords: thinking, running N tool calls, running a hook, reading results (D6)", () => {
    assert.equal(turnStateWords({ to: "planning", why: "round 2" }), "thinking");
    assert.equal(turnStateWords({ to: "acting", why: "3 tool calls" }), "running 3 tool calls");
    assert.equal(turnStateWords({ to: "acting", why: "1 tool call" }), "running 1 tool call");
    assert.equal(turnStateWords({ to: "acting", why: "turn-end hook" }), "running a hook");
    assert.equal(turnStateWords({ to: "acting", why: "resumed" }), "running tools");
    assert.equal(turnStateWords({ to: "observing", why: "results appended" }), "reading results");
    assert.equal(turnStateWords({ to: "idle" }), "");
    assert.equal(turnStateWords(null), "");
  });

  test("windowSourceWords and verdictWords: one owner for the words the run card and the Context widget share (D6)", () => {
    // (fails before: yes — the operator's window was said to come "from your pricing table", the global table P1b
    // removed; it is the upstream's model card)
    assert.equal(windowSourceWords("operator"), "from its upstream's model card");
    assert.equal(windowSourceWords("endpoint"), "from the provider's model list");
    assert.equal(windowSourceWords("builtin"), "Filament's built-in estimate");
    assert.equal(windowSourceWords(null), "unknown for this model");
    assert.equal(verdictWords("fits", 150_000), "fits (compacts at 150,000)");
    assert.equal(verdictWords("tight", 150_000), "fits, near the compaction line (compacts at 150,000)");
    assert.equal(verdictWords("edge"), "past the compaction line");
    assert.equal(verdictWords("over", 1), "was over the window itself");
    assert.equal(verdictWords("unknown"), "was not measured against a window");
  });

  // (fails before: yes — the banner read the refusal's wording)
  test("the card that asks is chosen from the refusal's fields, never its words (D5, C26)", () => {
    const card = read("src/ui/harness/conversation/interaction.js");
    for (const field of [/errorBody\?\.resumeQuestion/, /errorBody\?\.needsCompaction/, /facts\?\.needsRoom/]) assert.match(card, field);
    assert.equal(/compaction\\?\.mode is ask\//.test(card), false, "no regex over the message");
    const timeline = read("src/ui/harness/conversation/timeline.js");
    assert.equal((timeline.match(/const ask = askOf\(/g) || []).length, 2, "a history turn and a turn just ended ask the same way");
  });
});

// ---------------------------------------------------------------------------------------------------
// The widget system (D8, D9) — a registry, a layout, one context object; no DOM
// ---------------------------------------------------------------------------------------------------

describe("Step 4: the widget system", () => {
  /**
   * A widget context with mutable state the test drives: the view, whether the session exists, the live figures, the
   * chosen coding agent and its account.
   * @param {{ view?: any, born?: boolean, live?: any, preview?: any, models?: any[], agent?: any }} [s]
   */
  const world = (s = {}) => {
    const state = { turns: /** @type {any[]} */ ([]), view: s.view ?? null, born: s.born ?? true, live: s.live ?? { rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false }, preview: s.preview ?? null, models: s.models ?? [], subagents: /** @type {any[]} */ ([]), agent: /** @type {any} */ (s.agent ?? null) };
    /** @type {string[]} */
    const did = [];
    /** @type {import("../src/ui/harness/widgets/registry.js").WidgetContext} */
    const ctx = {
      view: () => state.view,
      hasSession: () => state.born,
      knobs: () => KNOBS,
      live: () => state.live,
      turns: () => state.turns,
      setWindow: () => {},
      write: (c) => did.push(`write ${JSON.stringify(c)}`),
      command: (t) => did.push(`command ${t}`),
      openPane: (p) => did.push(`pane ${p}`),
      openPage: (p) => did.push(`page ${p}`),
      memoryEngine: () => null,
      toast: () => {},
      summon: () => did.push("summon"),
      openHow: () => did.push("how"),
      stopAndCompact: () => did.push("stop-and-compact"),
      undoCompaction: (id) => did.push(`undo:${id}`),
      preview: async () => state.preview ?? null,
      models: () => state.models,
      scrollToTurn: (n) => { did.push(`scroll ${n}`); return true; },
      dryRun: () => did.push("dry run"),
      subagents: {
        rows: () => state.subagents,
        models: () => [],
        sessionModel: () => "m",
        cache: () => ({ state: "none", running: false, leftMs: 0, ttlMs: 0, tokens: 0, model: null }),
      },
      memory: {
        confirm: async (id) => (did.push(`confirm ${id}`), { ok: true }),
        correct: async (id) => (did.push(`correct ${id}`), { ok: true }),
        forget: async (id) => (did.push(`forget ${id}`), { ok: true }),
        answer: async (id, answer) => (did.push(`answer ${id} ${answer}`), { ok: true }),
      },
      team: { open: () => did.push("open team"), back: () => did.push("back to your agent"), wait: () => null },
      accounts: {
        session: () => state.agent,
        check: async (u) => { did.push(`check ${u}`); },
        useResetCredit: async (u) => { did.push(`reset credit ${u}`); return "reset"; },
        rows: () => state.rows || (state.agent ? [state.agent] : []),
        signIn: (u) => did.push(`sign in ${u}`),
        switchTo: (u) => did.push(`switch to ${u}`),
        manage: () => did.push("manage accounts"),
      },
    };
    return { state, ctx, did };
  };
  /** Mount the default layout into three recording slots, the covered settings drawn as one row per path. */
  const mount = (/** @type {ReturnType<typeof world>} */ w) => {
    const slots = { bar: fakeH("span", { class: "widget-slot slot-bar" }), strip: fakeH("span", { class: "widget-slot slot-strip" }), meters: fakeH("span", { class: "widget-slot slot-meters" }) };
    const { popover, pops } = recordingPopover();
    /** @type {string[][]} */
    const drawn = [];
    const rows = (/** @type {any} */ covers) => { drawn.push([...covers.paths]); return covers.paths.map((/** @type {string} */ p) => fakeH("div", { class: "row" }, p)); };
    const host = mountWidgets(slots, w.ctx, { h: fakeH, drawIn: fakeDrawIn, popover, rows });
    return { slots, host, pops, drawn };
  };

  /** The first node under `el` (depth-first, itself included) that carries the class token exactly — a substring
   *  match would find ".wg-slider-row" before ".wg-slider". @param {any} el @param {string} cls */
  const findNode = (el, cls) => {
    /** @param {any} n */
    const walk = (n) => {
      if (!n || typeof n !== "object") return null;
      if (n.classList?.contains?.(cls)) return n;
      for (const kid of n.kids || []) {
        const hit = walk(kid);
        if (hit) return hit;
      }
      return null;
    };
    return walk(el);
  };

  // (fails before: yes — the widgets were hard-wired into the composer and the header)
  test("every id in the layout resolves in the registry, and each slot mounts its widgets in the layout's order (D8, Step 6 design)", () => {
    for (const [slot, ids] of Object.entries(DEFAULT_LAYOUT)) for (const id of ids) assert.ok(Object.hasOwn(WIDGETS, id), `${slot}: ${id} is registered`);
    assert.deepEqual(widgetsFor("strip", { strip: ["memory", "nope", "speed"] }), ["memory", "speed"], "an unknown id is left out, the order kept");
    // (the owner's of 11-07: the presets went, and their widget: a layout kept from before that names it shows the rest)
    assert.deepEqual(widgetsFor("strip", { strip: ["preset", "memory"] }), ["memory"]);
    const w = world({ view: { settings: {}, windows: [] } });
    const { slots, host } = mount(w);
    // (fails before: yes — the typing row held the context ring alone: nothing by the box said who answers what
    // you type)
    assert.deepEqual(host.widgets.bar.map((x) => x.spec.id), ["account", "context", "team"], "whose plan answers, how full the context is, the team");
    // (fails before: yes — the strip also held a View and a Compaction pill: HarnessV4_Tasks U3-4, UX-1)
    // (fails before: yes — proposal_ux V8: the preset, chosen at the start, left the strip for Overview; the owner's
    // words of 10-29: the Task graph pill left it, the task graph always on; the owner's of 10-30: the Memory pill left
    // it, its Overview tile opening the same card, for where the chat works)
    // (fails before: yes — the owner's word of 11-05: the Watch pill stood there, for the agent that watched)
    assert.deepEqual(host.widgets.strip.map((x) => x.spec.id), [], "the strip's left holds no pill: the Watch pill went with the agents that started by themselves");
    assert.equal(Object.hasOwn(TILES, "memory"), true, "memory's card is its Overview tile's");
    assert.deepEqual(["strategies", "compaction"].filter((id) => Object.hasOwn(WIDGETS, id)), [], "the View and Compaction pills are gone, registry and all: the ring's popover and the Context tab hold what they held");
    assert.deepEqual(host.widgets.meters.map((x) => x.spec.id), ["speed", "cache", "spend"], "how fast the model writes and what it costs, on its right");
    // (fails before: yes — the header held the windows chip; before it, the Agents pill and its launcher: HarnessV4_Tasks
    // E15 step 5, BW-15)
    assert.deepEqual(Object.keys(DEFAULT_LAYOUT), ["bar", "strip", "meters"], "the header holds no widget");
    assert.equal(Object.hasOwn(WIDGETS, "windows"), false, "the windows chip is gone, registry and all");
    assert.equal(Object.hasOwn(WIDGETS, "subagents"), false, "the Agents pill is gone, registry and all: the Side tab holds what its launcher held");
    assert.deepEqual(slots.strip.kids, host.widgets.strip.map((x) => x.el), "the pills sit in their slot, in order");
    // (fails before: yes — the engine widget was registered and stood nowhere: another instrument took its place in the
    // header, and nothing else could mount it; proposal_ux §5: Overview's tiles are a place too)
    assert.deepEqual(Object.keys(WIDGETS).filter((id) => !Object.values(DEFAULT_LAYOUT).some((ids) => ids.includes(id)) && !Object.hasOwn(TILES, id)), [], "every registered widget stands somewhere");
    // Placement is data: the same widget moves by editing the table, nothing else.
    const moved = mountWidgets({ strip: fakeH("span") }, w.ctx, { h: fakeH, drawIn: fakeDrawIn, popover: recordingPopover().popover, layout: { strip: ["context", "speed"] } });
    assert.deepEqual(moved.widgets.strip.map((x) => x.spec.id), ["context", "speed"]);
  });

  test("visible() hides a pill: the strip and the meters wait for the session (D8, FC 15)", () => {
    const w = world({ view: { settings: {}, windows: [{ window: "harness" }] }, born: false });
    const { host } = mount(w);
    for (const x of [...host.widgets.strip, ...host.widgets.meters]) assert.equal(x.el.classList.contains("hidden"), true, `${x.spec.id} hidden before the session exists`);
    const bar = (/** @type {string} */ id) => /** @type {any} */ (host.widgets.bar.find((x) => x.spec.id === id));
    assert.equal(bar("context").el.classList.contains("hidden"), false, "the meter counts the typed text before any session");
    assert.equal(bar("account").el.classList.contains("hidden"), true, "no coding agent chosen: no account");
    w.state.born = true;
    w.state.view = { settings: {}, windows: [{ window: "w1", clientLabel: "OpenCode" }, { window: "harness", clientLabel: "the harness" }] };
    host.paint();
    const waits = ["speed", "cache"];
    for (const x of [...host.widgets.strip, ...host.widgets.meters].filter((x) => !waits.includes(x.spec.id))) assert.equal(x.el.classList.contains("hidden"), false, `${x.spec.id} shown with the session`);
    // The Cache pill waits for a request that says its cache numbers (lib/cache-facts.js): a chat with none has no pill.
    const cache = /** @type {any} */ ([...host.widgets.strip, ...host.widgets.meters].find((x) => x.spec.id === "cache"));
    assert.equal(cache.el.classList.contains("hidden"), true, "no request has said its cache numbers: no cache pill");
    w.state.view = { ...w.state.view, settings: { usage: { requests: 1, input: 100, cacheRead: 30_000, cacheWrite: 900, cacheSeen: 31_000, last: { at: Date.now(), input: 100, cacheRead: 30_000, cacheWrite: 900, cacheSeen: true } } } };
    host.paint();
    assert.equal(cache.el.classList.contains("hidden"), false, "a request said them: the pill is its share");
    // The speed waits for a reply to have streamed, not for the session (HarnessV3-AtHome AH-S1).
    const speed = /** @type {any} */ (host.widgets.meters.find((x) => x.spec.id === "speed"));
    assert.equal(speed.el.classList.contains("hidden"), true, "no reply has streamed: no speed");
    w.state.live = { ...w.state.live, speed: { live: false, rate: null, average: 41.6, tokens: 900, writingMs: 5400, settled: true } };
    host.paint();
    assert.equal(speed.el.classList.contains("hidden"), false, "the last reply's average");
  });

  // (fails before: yes — the strip held the Task graph pill, whose switch wrote engine.taskGraph, Overview offered its
  // tile, and Ctrl+K, the Plan view and the settings' words read the switch; the owner's words of 10-29: "the task graph
  // must always be on and users should not be able to turn it off")
  test("the task graph has no switch: no pill under the box, no widget or tile, and no part of the page reads or writes engine.taskGraph", () => {
    const w = world({ view: { settings: {}, windows: [] } });
    const { host } = mount(w);
    const mounted = Object.values(host.widgets).flat();
    assert.deepEqual(mounted.filter((x) => x.spec.id === "graph" || /task graph/i.test(String(x.spec.label))).map((x) => x.spec.id), [], "nothing under the box is the task graph's");
    assert.deepEqual(["graph"].filter((id) => Object.hasOwn(WIDGETS, id) || Object.hasOwn(TILES, id)), [], "no Task graph widget, and no tile of it on Overview");
    /** @type {string[]} */
    const said = [];
    const walk = (/** @type {string} */ dir) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== "vendor") walk(p); } else if (p.endsWith(".js") && read(p).includes("taskGraph")) said.push(p);
      }
    };
    walk("src/ui");
    assert.deepEqual(said, []);
  });

  // (fails before: yes — the meter was a flat track and a wall of rows; the instrument is a ring toward the line)
  test("the Context instrument: the face is the ring and the percent, the tone follows the compaction line, the popover is the stacked bar, its legend and the room in one sentence", () => {
    const record = { tokens: { input: 1000, cacheRead: 60000, cacheWrite: 3000 }, view: { historyTokens: 40000, shapedTokens: 40000, composition: { userText: 8000, assistantText: 8000, toolUse: 4000, toolResult: 140000, thinking: 0, subagents: 0, system: 12000, tools: 20000 } }, memory: { tokens: 0, composition: {} } };
    const view = { settings: { window: { tokens: 200_000, source: "operator", model: "claude-opus-5-5" }, flat: { "context.compaction.thresholdPercent": 85 } } };
    const w = world({ view, live: { rec: record, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false } });
    const spec = WIDGETS.context(w.ctx, { h: fakeH, drawIn: fakeDrawIn });
    assert.equal(spec.state(), "32%", "64,000 of 200,000 held");
    assert.equal(spec.tone?.(), "", "far from the line");
    assert.match(String(spec.title?.()), /64,000 of 200,000 tokens — 106K of room before compaction at 85%\./);
    const face = textOf(spec.face?.(fakeH));
    assert.equal(face, "32%", "the face says the percent (the ring is drawn beside it)");
    assert.match(String(spec.face?.(fakeH).kids[0].attrs.html), /<svg[^>]*>.*inst-notch/, "the ring carries the compaction line's notch");
    const body = spec.panel?.(fakeH, () => {});
    const text = textOf(body);
    for (const bit of ["Context", "Claude Opus 5.5 · 200K window", "32|%", "64K of 200K", "Your line|170K · 85%", "Makes room by|Same model", "Ask before making room", "System & tools", "Messages", "Tool work", "Room to your line", "106K of room before your line (170K). A running turn makes room there and carries on; a message you send past it asks first.", "Compact now…", "How earlier turns are kept", "Dry run", "Next request"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
    // Another way and Context settings left the popover for the card and the sheet (proposal_ux V9, §4.12).
    assert.doesNotMatch(text, /Another way|Context settings|One summary/);
    assert.doesNotMatch(text, /Thinking/, "an empty part stays out of the legend");
    assert.doesNotMatch(text, /Tokens processed|processed/i, "tokens processed moved to Spend");
    // Compact now… brings the card up and never compacts (D6); the link opens the sheet.
    for (const label of ["Compact now…", "How earlier turns are kept", "Dry run"]) buttonsOf(body).find((b) => textOf(b).replace(/^\|/, "").startsWith(label)).dispatch("click");
    assert.deepEqual(w.did, ["summon", "how", "dry run"]);
    // Nearing the line warns; past it is an error, and the sentence says what the next turn does.
    w.state.live = { ...w.state.live, rec: { ...record, tokens: { input: 0, cacheRead: 150_000, cacheWrite: 0 } } };
    assert.equal(spec.tone?.(), "warn", "150K is within 15% of the 170K line");
    w.state.live = { ...w.state.live, rec: { ...record, tokens: { input: 0, cacheRead: 175_000, cacheWrite: 0 } } };
    assert.equal(spec.tone?.(), "error");
    assert.match(String(spec.title?.()), /Past the compaction line \(85%\) — your next message asks how to make room first\./);
  });

  // (fails before: yes — the Context popover and its Overview tile offered Compact now… on a client's session, and one
  // the harness had typed into counted as the harness's)
  test("a client's session is offered no Compact now…, the harness's turns there or not: its client compacts it", () => {
    const settings = { native: false, window: { tokens: 200_000, source: "catalog", model: "claude-opus-5-5" }, flat: { "context.compaction.thresholdPercent": 85 } };
    const live = { rec: null, usage: null, facts: null, liveOut: 0, estimate: 5000, streaming: false };
    const labels = (/** @type {any} */ node) => buttonsOf(node).map((b) => textOf(b).replace(/^\|/, ""));
    for (const view of [{ settings, windows: [] }, { settings, windows: [{ window: "opencode" }, { window: "harness" }] }]) {
      assert.equal(isClientView(view), true, JSON.stringify(view.windows));
      const spec = /** @type {any} */ (WIDGETS.context(world({ view, live }).ctx, { h: fakeH, drawIn: fakeDrawIn }));
      const panel = labels(spec.panel(fakeH, () => {}));
      assert.ok(!panel.some((x) => x.startsWith("Compact now") || x.startsWith("Stop and compact")), `the popover: ${panel.join(" · ")}`);
      assert.ok(panel.some((x) => x.startsWith("How earlier turns are kept")), "the sheet stays");
      const tile = labels(fakeH("div", {}, ...[spec.tile(fakeH, "L")].flat()));
      assert.ok(!tile.some((x) => x.startsWith("Compact now")), `the tile: ${tile.join(" · ")}`);
      assert.ok(tile.some((x) => x.startsWith("How earlier turns are kept")), "the tile's sheet stays");
    }
    const own = { settings: { ...settings, native: true }, windows: [] };
    assert.equal(isClientView(own), false, "the harness's own chat is no client's");
    const spec = /** @type {any} */ (WIDGETS.context(world({ view: own, live }).ctx, { h: fakeH, drawIn: fakeDrawIn }));
    assert.ok(labels(spec.panel(fakeH, () => {})).some((x) => x.startsWith("Compact now")), "and offers Compact now…");
    assert.ok(labels(fakeH("div", {}, ...[spec.tile(fakeH, "L")].flat())).some((x) => x.startsWith("Compact now")), "on its tile too");
  });

  test("the Context instrument without a window: the tokens alone, an estimate says so; compactionLine reads the session's percent, else the stale edge", () => {
    const w = world({ view: { settings: {} }, born: false, live: { rec: null, usage: null, facts: null, liveOut: 0, estimate: 1234, streaming: false } });
    const spec = WIDGETS.context(w.ctx, { h: fakeH, drawIn: fakeDrawIn });
    assert.equal(spec.state(), "1.2K est");
    assert.equal(spec.marks?.().hollow, true);
    assert.equal(textOf(spec.face?.(fakeH)), "1.2K est");
    // An empty draft before any reply: the hollow ring alone, no "0 est" — and the pill is named by its sentence.
    w.state.live = { ...w.state.live, estimate: 0 };
    assert.equal(spec.state(), "");
    assert.equal(textOf(spec.face?.(fakeH)), "");
    assert.match(String(spec.face?.(fakeH).kids[0].attrs.html), /class="inst-track"/, "the ring is drawn, empty");
    const { host } = mount(w);
    const pill = /** @type {any} */ (host.widgets.bar.find((x) => x.spec.id === "context")?.el);
    assert.match(String(pill.attrs["aria-label"]), /^Context: 0 tokens held/, "never “Context: ” with nothing after it");
    assert.deepEqual(compactionLine({ settings: { flat: { "context.compaction.thresholdPercent": 70 } } }, 200_000, 150_000), { f: 0.7, tokens: 140_000, percent: 70 }, "the session's percent — the line the next request is judged by");
    assert.deepEqual(compactionLine({ settings: {} }, 200_000, 150_000), { f: 0.75, tokens: 150_000, percent: 75 }, "no knob: the last request's edge");
    assert.equal(compactionLine({ settings: {} }, null, 150_000), null, "no window, no line");
  });

  test("windowParts: memory as one part, the conversation split by its characters into messages, tool work and thinking; the parts add up", () => {
    const rec = { tokens: { input: 0, cacheRead: 100_000, cacheWrite: 0 }, view: { historyTokens: 50_000, shapedTokens: 50_000, composition: { userText: 10_000, assistantText: 30_000, toolUse: 20_000, toolResult: 120_000, thinking: 20_000, subagents: 0, system: 8000, tools: 12000 } }, memory: { tokens: 2000, composition: { briefing: 1000 } } };
    const p = windowParts(rec);
    const by = Object.fromEntries(p.parts.map((x) => [x.key, x.tokens]));
    assert.equal(by.memory, 2000, "the briefing and the blocks, one part");
    assert.equal(by.tools, 35_000, "tool calls and results: 140K of 200K characters of 50K");
    assert.equal(by.thinking, 5000);
    assert.equal(by.messages, 10_000, "what rounding leaves goes to the messages");
    assert.equal(p.parts.reduce((n, x) => n + x.tokens, 0), 100_000, "the parts add up to the provider's count");
  });

  test("the compaction line on the ring's bar, in tokens: the thumb writes the percent once let go; what a message does first and the history on the Context tab; Compact now", async () => {
    const view = { settings: { window: { tokens: 200_000, source: "operator" }, flat: { "context.compaction.thresholdPercent": 85 }, effective: { context: { compaction: { mode: "auto" } } } }, facts: { context: { held: 40_000 } } };
    const preview = { compactions: [{ id: 1, fromTurn: 1, toTurn: 12, kind: "compaction", method: "summary", at: Date.now() - 60_000, detail: null, undoable: false }] };
    const w = world({ view, preview });
    const spec = WIDGETS.context(w.ctx, { h: fakeH, drawIn: fakeDrawIn });
    const body = spec.panel?.(fakeH, () => {});
    await new Promise((r) => setTimeout(r, 0));
    const text = textOf(body);
    for (const bit of ["Your line|170K · 85%", "40K of 200K", "130K of room before your line (170K)", "Compact now"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
    const slider = findNode(body, "inst-slider");
    assert.deepEqual([slider.attrs.min, slider.attrs.max, slider.attrs.value], [String(LINE_MIN), String(LINE_MAX), "85"]);
    slider.dispatch("input", { target: { value: "70", setAttribute() {} } });
    assert.ok(textOf(body).includes("Your line|140K · 70%"), `the chip follows the thumb while it moves: ${textOf(body)}`);
    assert.ok(textOf(body).includes("100K of room before your line (140K)"), "and so does the room — never the line the popover opened with");
    assert.deepEqual(w.did, [], "nothing is written while it moves");
    // One scale: the slider rides a rail over exactly the band the line may take, on the bar's own 0–100%.
    const rail = findNode(body, "inst-cap-rail");
    assert.equal(rail.attrs.style, `left:${LINE_MIN}%;width:${LINE_MAX - LINE_MIN}%`);
    assert.equal(findNode(body, "inst-cap-zone").attrs.style, rail.attrs.style, "the band and the rail are the same span");
    assert.ok(rail.kids.includes(slider), "the thumb is the line");
    // The pill warns as the Context face does, from the same arithmetic.
    assert.deepEqual(standing(40_000, 200_000, 85), { lineTokens: 170_000, tone: "" });
    assert.equal(standing(150_000, 200_000, 85).tone, "warn", "within 15% of the line");
    assert.equal(standing(170_000, 200_000, 85).tone, "error", "at the line");
    assert.equal(standing(170_000, null, 85).tone, "", "no window, no standing");
    assert.equal(spec.tone?.(), "");
    slider.dispatch("change", { target: { value: "70" } });
    assert.deepEqual(w.did, ['write {"patch":{"context":{"compaction":{"thresholdPercent":70}}}}'], "written once, when let go");
    buttonsOf(body).find((b) => textOf(b).replace(/^\|/, "").startsWith("Compact now")).dispatch("click");
    assert.equal(w.did.at(-1), "summon", "Compact now… brings the card up");
    // The mode and the compactions so far: the sheet's parts (proposal_ux §4.12 step 4).
    const section = howSection(w.ctx, { h: fakeH, drawIn: fakeDrawIn, key: "step4-line" });
    await new Promise((r) => setTimeout(r, 0));
    const how = section.el;
    for (const bit of ["When the chat is full", "Your line", "170K · 85%", "Then", "Just do it", "Back after a break", "How it makes room", "The way", "History", "1 so far", "Turns 1–12 summarized"]) assert.ok(textOf(how).includes(bit), `${bit} in ${textOf(how)}`);
  });

  test("the compose cache the host holds: a compaction busts it, and a slow answer cannot land under a newer key (source contract)", () => {
    // app.js boots a DOM at import, so its cache logic is pinned as a source contract — the two rules the bug
    // hunt found the hard way: a compaction moves neither the settings hash nor the turn count, so Compact now
    // busts the epoch; and a fetch that outlives its state must not overwrite the newer state's answer.
    const src = read("src/ui/harness/app.js");
    const at = src.indexOf("async function compactNow");
    const block = src.slice(at, src.indexOf("\n}\n", src.indexOf("async function compactAsk", at)));
    // Compact now places its row through the one function a command's compaction uses too (HarnessV3-Launch RD-D4).
    assert.match(block, /placeCompaction\(chat, r\.boundary\)/, "Compact now places its row");
    const placed = src.slice(src.indexOf("function placeCompaction"), src.indexOf("function placeCompaction") + 800);
    assert.match(placed, /bustPreview\(\)/, "placing a compaction busts the compose cache — the boundary row is the only other trace");
    assert.match(src, /if \(previewCache\.key === asked\) previewCache\.data = p;/, "a slow compose answer cannot land under a newer key");
    assert.match(src, /\$\{previewCache\.epoch\}/, "the epoch rides the cache key");
    // (fails before: yes — the key held the count of turns, which the page moves when a turn starts: a preview read
    // while a turn ran was served again after its end, a turn behind)
    assert.match(src, /const previewKeyOf = \(c\) => `\$\{c\.chainId\}\|\$\{c\.view\?\.settings\?\.hash \|\| ""\}\|\$\{\(c\.turns \|\| \[\]\)\.length - \(c\.live \? 1 : 0\)\}\|\$\{previewCache\.epoch\}`;/, "the key counts the turns that have ended: a running one joins at its end");
    assert.match(src, /const key = previewKeyOf\(c\);/, "the cache asks under that key");
    assert.match(src, /previewKey: \(\) => \{ const c = sessionChat\(\); return c \? previewKeyOf\(c\) : ""; \},/, "and the widgets read the same key, so a section redraws when its preview would differ");
    assert.match(src, /turns: \(\) => chatOf\(state\.currentId\)\?\.turns \|\| \[\]/, "the per-turn figures Spend and Cache chart come from the open chat");
  });

  test("windowFacts: the window of the model in force first, then the last request's; the verdict is the last request's (D4)", () => {
    const view = { settings: { window: { tokens: 1_000_000, source: "operator" } }, facts: { context: { window: 200_000, usable: 150_000, verdict: "fits", source: "endpoint" } } };
    assert.deepEqual(windowFacts(view, null), { window: 1_000_000, source: "operator", usable: 150_000, verdict: "fits" }, "a model change: the new window before the next request");
    assert.deepEqual(windowFacts({ settings: {}, facts: view.facts }, null), { window: 200_000, source: "endpoint", usable: 150_000, verdict: "fits" });
    assert.deepEqual(windowFacts({ settings: {} }, { rec: { context: { window: 8000, usable: 3804, verdict: "tight", source: "operator" } } }), { window: 8000, source: "operator", usable: 3804, verdict: "tight" }, "the live record while the page has it");
    assert.deepEqual(windowFacts(null, null), { window: null, source: null, usable: null, verdict: null });
    const composer = read("src/ui/harness/composer/composer.js");
    assert.equal(/contextWindow|\/models/.test(composer), false, "the composer never looks a window up in the model list");
  });
});

// ---------------------------------------------------------------------------------------------------
// Auto-fit per session, on the live app (D2, D3) — an outside client's chat reaches both doors
// ---------------------------------------------------------------------------------------------------

describe("Step 4 on the live app: auto-fit obeys the session", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** The summarizer answers unless a test says it fails. */
  let summarizerFails = false;
  const isCompaction = (/** @type {any} */ call) => JSON.stringify(call.body || "").includes("You write compaction summaries");
  const SYS = "You help.";
  /** @param {string} text */
  const person = (text) => ({ role: "user", content: [{ type: "text", text }] });
  /** @param {string} text */
  const model = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
  /** A history past the 8,000-token window's usable edge (3,804 at max_tokens 100) and under the window itself. */
  const filler = (n = 16) => Array.from({ length: n }, (_, i) => [person(`turn ${i} ${"filler ".repeat(200)}`), model(`ok ${i}`)]).flat();
  /** @param {string} sid @param {any[]} messages @param {string} [mdl] */
  const zc = async (sid, messages, mdl = "m-1") => {
    const r = await shim.post("/v1/messages", { model: mdl, max_tokens: 100, system: SYS, messages }, { "x-session-id": sid, "x-filament-cwd": process.cwd(), "user-agent": "opencode/1.2" });
    return { status: r.status, text: await r.text(), id: r.headers.get("x-filament-request-id") };
  };
  /** @param {string} sid */
  const chainOf = (sid) => /** @type {any} */ (shim.app.memory.archive).chainIdForKey(chainKeyForConversationId(sid));
  /** @param {string} sid @param {any} patch */
  const setFor = async (sid, patch) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(chainOf(sid))}/settings`, { method: "PATCH", body: { patch } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** The main calls (not the summarizer's) since a mark. @param {number} from */
  const mainCalls = (from) => up.received.slice(from).filter((c) => !isCompaction(c) && c.kind === "anthropic");
  /** @param {string | null} id */
  const recordOf = async (id) => (await shim.api(`/api/requests/${encodeURIComponent(String(id))}`)).json();

  before(async () => {
    up = await fakeUpstream((call) => {
      const body = call.body || {};
      if (isCompaction(call)) return summarizerFails ? { status: 500, json: { error: { message: "summarizer down" } } } : anthropicReply("the early turns set up the flux capacitor", { model: body.model });
      // zz-*: a model with no known window, whose provider refuses a body it did not see compacted.
      if (String(body.model).startsWith("zz-") && !JSON.stringify(body.messages || []).includes("Filament auto-fit"))
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 9000 tokens > 8000 maximum" } } };
      return anthropicReply("ok", { model: body.model });
    });
    shim = await startApp({
      memory: true,
      summarizer: "sum-1",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 8000 } } }];
        cfg.routes = [
          { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "sum-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "zz-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  // (2026-09-28: the ladder left the request path — these were its per-session doors, all removed)
  test("an oversized outside client's request: out whole, no summary asked, the window still stamped — /autofit goes to its model as typed, and the fit's route says the limit", async () => {
    const sid = "s4-native";
    await zc(sid, [person("warm up")]);
    const mark = up.received.length;
    const r = await zc(sid, [...filler(), person("the real question")]);
    assert.equal(r.status, 200, r.text);
    assert.equal(up.received.slice(mark).filter(isCompaction).length, 0, "no summary was asked for — nothing sits between the client and its provider");
    const sent = JSON.stringify(mainCalls(mark).at(-1)?.body.messages);
    for (let i = 0; i < 16; i++) assert.ok(sent.includes(`turn ${i} filler`), `turn ${i} went out`);
    assert.equal(sent.includes("Filament auto-fit"), false, "nothing compacted, nothing noted in the body");
    const rec = await recordOf(r.id);
    assert.equal(rec.context?.window, 8000, "the window is still stamped");
    assert.equal(rec.autofit, undefined, "the ladder never ran — there is no ladder");
    // /autofit on this outside session goes to its model as typed: the client owns the history, and its chat is a plain
    // proxy with memory (the owner's rules of 10-31).
    const asked = mainCalls(mark).length;
    const cmd = await zc(sid, [person("warm up"), model("ok"), person("/autofit status")]);
    assert.equal(cmd.status, 200);
    assert.equal(mainCalls(mark).length, asked + 1, "the model was called");
    assert.ok(JSON.stringify(mainCalls(mark).at(-1)?.body.messages.at(-1)).includes("/autofit status"), "with the words as typed");
    // (fails before: no — a guard: the console's fit of this session says the numbers and the limit, and writes nothing)
    const archive = /** @type {any} */ (shim.app.memory.archive);
    const chainId = archive.chainIdForKey(chainKeyForConversationId(sid));
    const fit = await (await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/autofit`, { method: "POST", body: {} })).json();
    assert.equal(fit.action, "outside", JSON.stringify(fit));
    assert.match(fit.note, /the client owns the history, and Filament reshapes nothing between them\. The numbers: /);
    assert.equal(archive.getCompactions(chainId).length, 0, "nothing compacted");
  });
  });

// The compaction brief itself is one constant the summarizer receives on every path.
test("COMPACTION_SYSTEM is compaction's own brief (D1)", () => {
  assert.match(COMPACTION_SYSTEM, /^You write compaction summaries/);
  assert.equal(/COMPACTION_SYSTEM\s*=/.test(read("src/app/sessions/compose.js")), false, "compose.js no longer carries it");
});
