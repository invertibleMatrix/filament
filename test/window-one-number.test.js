// @ts-check
// HarnessV3-Launch LD-D6 (2026-10-03): one number for the window, everywhere — on the page. The meter shows what the
// session holds now: a call stopped before the provider counted it is no figure (F23: the meter fell to 0 % after a
// Stop), and once a compaction was written since the newest model turn the figure is the server's measure of the next
// request (F20: the meter read 8 % before Compact now and 8 % after). Every percent in the popover is a share of the
// window (F10). And a turn Filament answers itself is not compacted at its start: which messages those are is read once,
// for the chat-command stage and the sessions service alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heldFigure, recordHeld, factsHeld, factsAfterCompaction, windowFacts, contextWidget } from "../src/ui/harness/widgets/context.js";
import { meterTurnOf } from "../src/ui/harness/conversation/history.js";
import { chatCommandOf } from "../src/app/commands/recognize.js";
import { fakeH, fakeDrawIn, textOf } from "./helpers/fake-dom.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

// (fails before: yes — a record that measured nothing was the figure: 0, "known")
test("a record that measured nothing is no figure: the facts stand, else the estimate", () => {
  const stopped = { tokens: { input: 0, output: 0 } };
  assert.equal(recordHeld(stopped), 0);
  assert.equal(recordHeld({ tokens: { input: 100, cacheRead: 900 } }), 1000);
  assert.equal(recordHeld({ tokens: { input: 1 } }, { input_tokens: 10, cache_read_input_tokens: 20 }), 30, "the reply's usage before the columns");
  assert.deepEqual(heldFigure({ rec: stopped, facts: { held: 300 }, estimate: 7 }), { tokens: 300, known: true });
  assert.deepEqual(heldFigure({ rec: stopped, estimate: 7 }), { tokens: 7, known: false });
  assert.deepEqual(heldFigure({ facts: { held: 0 }, estimate: 7 }), { tokens: 7, known: false }, "facts that counted nothing either");
  assert.equal(factsHeld({ held: 1000, context: { held: 9000 } }), 9000, "an agent turn's newest round");
  assert.equal(factsHeld(null), 0);
});

// (fails before: yes — the stopped turn was the meter's turn)
test("the meter's turn is the newest that measured something; one the page cannot judge yet still counts", () => {
  const model = { n: 1, status: "done", facts: { held: 300 }, requestId: "r1" };
  const stopped = { n: 2, status: "stopped", facts: { held: 0 }, requestId: "r2" };
  const unread = { n: 3, status: "done", requestId: "r3" };
  /** @param {any} t */
  const heldOf = (t) => (t.facts ? factsHeld(t.facts) : null);
  assert.equal(meterTurnOf([model, stopped], heldOf), model, "the Stop keeps the figure before it");
  assert.equal(meterTurnOf([model, stopped, unread], heldOf), unread, "a record not read yet is asked for, not skipped");
  assert.equal(meterTurnOf([stopped], heldOf), null, "nothing measured: nothing held");
});

// (fails before: yes — none of it existed; the meter kept the last request's figure through a compaction)
test("after a compaction the meter reads the server's measure of the next request: exact, with no stale verdict", () => {
  assert.equal(factsAfterCompaction({ compactedSince: false, whole: 900 }), null, "nothing compacted since the last turn: its request stands");
  assert.equal(factsAfterCompaction(null), null);
  const after = factsAfterCompaction({ compactedSince: true, tokens: 600, fixed: 300, whole: 900, window: 10000, usable: 8500 });
  assert.deepEqual(heldFigure({ facts: after, estimate: 7 }), { tokens: 900, known: true }, "drawn exact, not as an estimate");
  const view = { settings: {}, facts: { context: { window: 10000, usable: 8500, verdict: "over" } } };
  assert.deepEqual(windowFacts(view, { rec: null, facts: after }), { window: 10000, source: null, usable: 8500, verdict: null }, "the last request's verdict is not the next one's");
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /const after = factsAfterCompaction\(p\?\.current\) \|\| factsOfFreshStart\(p\?\.current\);/, "paintMeter reads the preview");
  assert.match(app, /meterTurnOf\(chat\.turns, \(t\) => /, "and judges each turn by what it measured");
  const body = (/** @type {string} */ head) => app.slice(app.indexOf(head), app.indexOf("\n}\n", app.indexOf(head)));
  assert.match(body("async function compactAsk("), /if \(chatOf\(state\.currentId\) === chat\) paintMeter\(chat\);\s*return true;/, "compactNow repaints the meter");
  assert.match(body("function compactionUndone("), /if \(!open\) return;[^]*\bpaintMeter\(chat\);$/, "an Undo, here or in another tab, repaints the open chat's meter");
});

/** The Context instrument over a live figure the test hands it. @param {any} live */
const panelOf = (live) => {
  /** @type {any} */
  const ctx = {
    view: () => ({ settings: { window: { tokens: 200000, source: "operator" }, flat: { "context.compaction.thresholdPercent": 85 } }, facts: null }),
    hasSession: () => true,
    live: () => live,
    compact() {},
    dryRun() {},
    scrollToTurn: () => true,
  };
  return /** @type {any} */ (contextWidget(ctx, { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn })).panel(fakeH, () => {});
};
/** Every node under `el` whose class list holds `cls`. @param {any} el @param {string} cls @returns {any[]} */
const findAll = (el, cls, out = /** @type {any[]} */ ([])) => {
  if (!el || typeof el !== "object") return out;
  if (String(el.attrs?.class || "").split(/\s+/).includes(cls)) out.push(el);
  for (const k of el.kids || []) findAll(k, cls, out);
  return out;
};

// (fails before: yes — the legend said each part's share of what was used: System & tools 63 %)
test("every percent in the popover is a share of the window, as the arcs are", () => {
  // An agent turn that ended at 9,000 of a 200,000-token window: system and tools 5,700, the rest the conversation.
  const comp = { userText: 400, assistantText: 400, toolUse: 400, toolResult: 8000, thinking: 0, subagents: 4000, system: 12000, tools: 8000 };
  const rec = { tokens: { input: 100, cacheRead: 900 }, view: { historyTokens: 500, shapedTokens: 500, composition: { userText: 400, system: 12000, tools: 8000 } }, context: { window: 200000, last: { held: 9000, rounds: 3, composition: comp } } };
  const body = panelOf({ rec, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false });
  const rows = Object.fromEntries(findAll(body, "inst-legend-row").map((r) => [textOf(findAll(r, "inst-legend-label")[0]), textOf(findAll(r, "inst-legend-share")[0] || {})]));
  assert.deepEqual(rows, { "System & tools": "3%", Messages: "<1%", "Tool work": "1%", "Sub-agents": "<1%", "Room to your line": "" }, JSON.stringify(rows));
});

// (fails before: yes — nothing said where a figure with no parts came from)
test("a figure measured after a compaction says so in the popover, drawn exact", () => {
  const facts = factsAfterCompaction({ compactedSince: true, whole: 9000, window: 200000, usable: 170000 });
  const body = panelOf({ rec: null, usage: null, facts, liveOut: 0, estimate: 0, streaming: false });
  const text = textOf(body);
  assert.match(text, /Measured after the compaction: the next request as Filament composes it now/);
  assert.match(text, /9K of 200K/, "no ≈: the server's measure, not the loop's running estimate");
  assert.doesNotMatch(text, /≈/);
});

// (fails before: yes — the sessions service read a command by its first character, so "/tmp/x …" was one)
test("which messages are Filament's own commands: read once, in the stage's order", () => {
  const memory = {
    cfg: () => ({ commands: { prefix: "@mem" } }),
    isOpen: () => true,
  };
  /** @param {string} text @param {boolean} [situated] */
  const kind = (text, situated = true) => chatCommandOf(text, { memory, situated })?.kind ?? null;
  assert.equal(kind("/autofit 10"), "autofit");
  assert.equal(kind("/autofit"), "autofit");
  assert.equal(kind("@mem status"), "mem");
  assert.equal(kind("@mem status", false), null, "`@mem` is memory's reading");
  // (fails before: yes — the owner's rules of 10-31: /trim answered a client's chat; there is no such command now)
  assert.equal(kind("/trim now"), null, "no /trim: the model's words");
  assert.equal(kind("/compact"), "compact");
  assert.equal(kind("/view keep 2"), null, "no /view: there is no choice of how earlier turns go");
  assert.equal(kind("/set loop.resultCapChars 9000"), "settings");
  assert.equal(kind("/preset plain"), null, "no /preset: there are no presets (the owner's of 11-07)");
  assert.equal(kind("/subagent list"), "subagent");
  assert.equal(kind("/goal ship it"), "goal");
  assert.equal(kind("/tmp/out.txt came out empty — why?"), null, "a path is the model's");
  assert.equal(kind("@src/app.js — what does it do?"), null, "so is a mention");
  assert.equal(kind("/status"), null, "the status trio hangs on the route: each caller reads it");
});

// (fails before: no — it pins the stage's own reading, which the mutation pass found unpinned once the reading moved)
test("a request memory stays out of: `@mem …` is the model's words, sent on untouched; `/trim …` is the model's everywhere", async () => {
  const up = await fakeUpstream((call) => (call.kind === "anthropic" ? anthropicReply("from the model", { model: String(call.body?.model || "m") }) : undefined));
  // The operator keeps memory away from m-1 (Memory settings, excluded models): its requests are never situated. m-2's
  // are, so `@mem` there is Filament's to answer; `/trim` is no command of Filament's (the owner's rules of 10-31).
  const shim = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory = { ...cfg.memory, capture: { ...cfg.memory?.capture, excludeModels: ["m-1"] } };
    },
  });
  try {
    for (const [text, situatedToo] of [["@mem status", false], ["/trim now", true]]) {
      for (const [model, theModels] of [["m-1", true], ["m-2", situatedToo]]) {
        up.reset();
        const r = await shim.post("/v1/messages", { model, max_tokens: 64, messages: [{ role: "user", content: text }] });
        const body = await r.text();
        assert.equal(r.status, 200, body);
        assert.equal(/from the model/.test(body), theModels, `${text} to ${model}: ${theModels ? "the model answered" : "Filament answered"} — ${body.slice(0, 200)}`);
        assert.equal(up.received.filter((c) => c.kind === "anthropic").length, theModels ? 1 : 0, `${text} to ${model}`);
      }
    }
  } finally {
    await shim.stop();
    await up.close();
  }
});

// (fails before: yes — the map's header weighed the history alone, a strategy card said a bare number, and the
// anatomy's percents were shares of the request; proposal_ux M5: the map is the Next request pane's)
test("the Next request pane weighs the whole request: Filament's part, the conversation and the draft, on the window's scale", () => {
  const src = readFileSync("src/ui/harness/panes/next-request.js", "utf8");
  assert.match(src, /const values = \{ fixed: Number\(c\.fixed\) \|\| 0, conversation: Number\(c\.tokens\) \|\| 0, draft: draftTokens \};/, "the parts: the loop's, the history, your draft");
  assert.match(src, /const whole = parts\.reduce\(\(n, p\) => n \+ p\.value, 0\);/, "the figure is the whole request");
  assert.match(src, /` of \$\{fmt\.n\(win\)\} tokens · \$\{Math\.min\(100, Math\.round\(\(whole \/ win\) \* 100\)\)\}%`/, "its percent is a share of the window");
  assert.match(src, /\{ total: win \|\| whole, tall: true, notch: win && c\.usable \? Number\(c\.usable\) \/ win : null \}/, "the bar on the window's scale, the line where room is made");
});
