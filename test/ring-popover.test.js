// @ts-check
// HarnessV4_Tasks U3-2: the ring's popover is the live control. A stacked bar of the window's parts on the window's
// own scale, the compaction line its thumb (15–95%, written as `context.compaction.thresholdPercent`), a coding agent's
// own point marked where it is not the line (A3: the turn's facts carry it, so the page works nothing out); one
// sentence per variant (U3.3); under the bar Your line as a chip — its stops and a number of your own (proposal_ux
// §4.12 step 2); Compact now…, which brings up the card that asks with every way (D6) — a press there never compacts;
// Stop and compact while an agent's turn runs past a line it can't act on (U2); How earlier turns are kept opens the
// sheet. On the fake DOM, one test per variant. (fails before: yes — every one: the popover was a donut with one
// sentence for all, and none of these pieces existed; then, U5 phase 3, Compact now named a way, Another way listed
// them with the model that writes them, and Context settings opened the Context pane)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contextWidget, agentPointOf, lineSentence, stopOffered, roomChoices } from "../src/ui/harness/widgets/context.js";
import { isClientView, sessionMethod, compactionParts } from "../src/ui/harness/widgets/compaction.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";

/**
 * The Context popover over a session the test describes: its window and line, its mode and method, a coding agent's
 * name, the live figures, the newest turn's facts, a client's name.
 * @param {{ window?: number, percent?: number, mode?: string, method?: string, agent?: boolean, name?: string,
 *   live?: any, facts?: any, client?: string, sources?: any, way?: string, models?: any[] }} [o]
 *   `way`: the agent's chosen way (`context.compaction.agent`); `models`: the page's model list, for the model's name
 */
const popover = (o = {}) => {
  const flat = {
    "context.compaction.thresholdPercent": o.percent ?? 85,
    // Automatic unless a test says otherwise: these sessions make room by themselves (asking first is the default).
    "context.compaction.mode": o.mode || "auto",
    ...(o.method ? { "context.compaction.method": o.method } : {}),
    ...(o.way ? { "context.compaction.agent": o.way } : {}),
  };
  const view = {
    settings: {
      window: o.window === 0 ? null : { tokens: o.window ?? 200_000, source: "operator", model: "opus" },
      flat,
      ...(o.client ? { native: false, sources: o.sources ?? {} } : {}),
    },
    facts: o.facts ?? null,
    windows: o.client ? [{ window: "w1", clientLabel: o.client }] : [],
  };
  /** @type {string[]} */
  const did = [];
  const state = { live: { rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false, agent: !!o.agent, ...o.live }, preview: /** @type {any} */ (null) };
  const ctx = {
    view: () => view,
    hasSession: () => true,
    live: () => state.live,
    turns: () => [],
    write: (/** @type {any} */ c) => did.push(`write ${JSON.stringify(c)}`),
    openPane: (/** @type {string} */ p) => did.push(`pane ${p}`),
    summon: () => did.push("summon"),
    openHow: () => did.push("how"),
    stopAndCompact: () => did.push("stop and compact"),
    dryRun: () => did.push("dry run"),
    preview: async () => state.preview,
    scrollToTurn: () => true,
    toast: (/** @type {string} */ msg) => did.push(`toast ${msg}`),
    accounts: { session: () => (o.name ? { agentName: o.name } : null) },
    models: () => o.models || [],
  };
  const spec = contextWidget(/** @type {any} */ (ctx), { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn });
  const draw = () => /** @type {any} */ (spec.panel?.(fakeH, () => did.push("closed"), () => did.push("relayout")));
  return { spec, draw, did, state, view };
};

/** The first node under `el` that `pred` takes. @param {any} el @param {(n: any) => boolean} pred @returns {any} */
const find = (el, pred) => {
  if (!el || typeof el !== "object") return null;
  if (pred(el)) return el;
  for (const k of el.kids || []) {
    const r = find(k, pred);
    if (r) return r;
  }
  return null;
};
/** A node by one of its classes as it was made. @param {any} el @param {string} cls */
const byClass = (el, cls) => find(el, (n) => String(n.attrs?.class || "").split(/\s+/).includes(cls));
/** Your line's chip, as it reads. @param {any} body */
const chipOf = (body) => textOf(byClass(body, "inst-line-chip"));
/** The popover's one sentence. @param {any} body */
const sentenceOf = (body) => textOf(byClass(body, "inst-lede"));
/** The buttons a person can press now, by their words: none inside a hidden part. @param {any} body */
const labels = (body) => {
  /** @type {string[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object" || n.classList?.contains("hidden")) return;
    if (n.tag === "button") out.push(textOf(n));
    for (const k of n.kids || []) walk(k);
  };
  walk(body);
  return out;
};
/** A coding agent's newest turn as its facts say it: what it held, the window it named, the point it was handed. @param {number} held @param {any} [point] @param {number} [window] */
const agentFacts = (held, point = null, window = 200_000) => ({ held, context: { held, window, source: "agent", usable: null, verdict: null, ...(point ? { point } : {}) } });
/** The loop's newest turn as its facts say it. @param {number} held */
const loopFacts = (held) => ({ held, context: { window: 200_000, usable: 170_000, verdict: "fits", source: "operator" } });

describe("the ring's popover, by variant (U3.3)", () => {
  test("Filament's loop, Automatic: the room before the line; your line's chip, the legend; Compact now… brings up the card, How earlier turns are kept the sheet", () => {
    const p = popover({ live: { facts: loopFacts(64_000) } });
    const body = p.draw();
    assert.equal(sentenceOf(body), "106K of room before your line (170K). A running turn makes room there and carries on; so does a message you send past it.");
    assert.equal(textOf(byClass(body, "inst-line-row")), "Your line|170K · 85%");
    assert.ok(textOf(body).includes("Room to your line|106K"), "the legend stays in Filament's sessions (UX-7)");
    assert.deepEqual(labels(body), ["170K · 85%", "Same model", "Compact now…", "How earlier turns are kept", "Dry run", "Next request"]);
    assert.ok(byClass(body, "inst-cap-zone") && byClass(body, "inst-cap-slider"), "the band and the line's thumb");
    const compact = buttonsOf(body).find((b) => textOf(b) === "Compact now…");
    assert.equal(compact.attrs.title, "Choose how to make room: every way, what each leaves and how long it takes");
    compact.dispatch("click");
    assert.deepEqual(p.did, ["closed", "summon"], "a press brings the card up: nothing is compacted");
    buttonsOf(body).find((b) => textOf(b) === "How earlier turns are kept").dispatch("click");
    assert.deepEqual(p.did.slice(2), ["closed", "how"]);
    // The card names the ways: Compact now… reads the same whatever the session makes room by; the row beside your
    // line names the session's.
    assert.deepEqual(labels(popover({ method: "fold", live: { facts: loopFacts(64_000) } }).draw()), ["170K · 85%", "Instant fold", "Compact now…", "How earlier turns are kept", "Dry run", "Next request"]);
    assert.equal(byClass(body, "inst-other"), null, "no list of ways of its own");
  });

  // (fails before: yes — HarnessV4_Tasks C26: the sentence said a running turn stops at the line to ask; it makes room
  // by itself, and only a message you send asks)
  test("Filament's loop, asking first: a message you send past the line asks; a turn that is running makes room by itself, and Stop and compact stands beside Compact now…", () => {
    assert.equal(sentenceOf(popover({ mode: "ask", live: { facts: loopFacts(64_000) } }).draw()), "106K of room before your line (170K). A running turn makes room there and carries on; a message you send past it asks first.");
    assert.equal(sentenceOf(popover({ mode: "ask", live: { facts: loopFacts(175_000) } }).draw()), "Past your line (170K) — your next message asks how to make room first.");
    const running = popover({ mode: "ask", live: { facts: loopFacts(64_000), streaming: true, liveHeld: 175_000 } }).draw();
    assert.equal(sentenceOf(running), "Past your line (170K) — the turn makes room at its next step.");
    // Whenever a turn runs (the owner's of 11-09): the ⌄ menu beside Send had it.
    assert.deepEqual(labels(running).slice(2, 4), ["Compact now…", "Stop and compact"]);
    assert.equal(buttonsOf(running).find((b) => textOf(b) === "Compact now…").attrs.title, "Choose how this turn makes room at its next step", "the card asks while the turn runs");
    assert.equal(sentenceOf(popover({ live: { facts: loopFacts(64_000), streaming: true, liveHeld: 175_000 } }).draw()), "Past your line (170K) — the turn makes room at its next step.");
    assert.equal(sentenceOf(popover({ live: { facts: loopFacts(175_000) } }).draw()), "Past your line (170K) — your next message makes room first.");
  });

  test("Claude Code handed the line (A3): it compacts there by itself, even mid-turn — the line is its point, no second mark", () => {
    const point = { at: 170_000, line: 170_000 };
    const body = popover({ agent: true, name: "Claude Code", live: { facts: agentFacts(50_000, point) } }).draw();
    assert.equal(sentenceOf(body), "120K before your line (170K). Claude Code compacts there by itself, even mid-turn.");
    assert.equal(byClass(body, "inst-cap-point").classList.contains("hidden"), true);
    assert.equal(chipOf(body), "170K · 85%");
    assert.doesNotMatch(textOf(body), /Room to your line|Dry run|Next request/, "no legend, no dry run, no map in an agent's session");
    assert.deepEqual(labels(body), ["170K · 85%", "Suggested", "Compact now…", "How earlier turns are kept"]);
    // Past it mid-turn: it makes room by itself.
    const past = popover({ agent: true, name: "Claude Code", live: { facts: agentFacts(50_000, point), streaming: true, liveHeld: 175_000 } }).draw();
    assert.equal(sentenceOf(past), "Past your line (170K) — Claude Code compacts by itself at its next step.");
    assert.deepEqual(labels(past).slice(2, 4), ["Compact now…", "Stop and compact"], "the line acts by itself: Stop and compact beside Compact now…, as while any turn runs");
    // Between turns, the next turn makes room first.
    assert.equal(sentenceOf(popover({ agent: true, name: "Claude Code", live: { facts: agentFacts(175_000, point) } }).draw()), "Past your line (170K) — your next message makes room first.");
  });

  test("Claude Code under 67K: it compacts at 67K at the earliest, marked on the bar; past your line short of it, Stop and compact", () => {
    const point = { at: 67_000, line: 50_000 };
    const at = (/** @type {any} */ live) => popover({ agent: true, name: "Claude Code", window: 100_000, percent: 50, live: { facts: agentFacts(20_000, point, 100_000), ...live } }).draw();
    const body = at({});
    assert.equal(sentenceOf(body), "Your line is 50K. Claude Code compacts by itself at 67K at the earliest, even mid-turn; Filament checks your line between turns.");
    const mark = byClass(body, "inst-cap-point");
    assert.deepEqual([mark.classList.contains("hidden"), mark.attrs.style], [false, "left:67%"]);
    assert.equal(chipOf(body), "50K · 50%", "its point is the sentence's and the mark's");
    const short = at({ streaming: true, liveHeld: 60_000 });
    assert.equal(sentenceOf(short), "Past your line (50K) mid-turn. Claude Code compacts by itself at 67K at the earliest; Filament checks your line between turns.");
    assert.deepEqual(labels(short), ["50K · 50%", "Suggested", "Stop and compact", "How earlier turns are kept"]);
    const beyond = at({ streaming: true, liveHeld: 70_000 });
    assert.equal(sentenceOf(beyond), "Past your line (50K) — Claude Code compacts by itself at its next step.");
    assert.deepEqual(labels(beyond).slice(2, 4), ["Compact now…", "Stop and compact"], "beside Compact now…, no longer in its place");
  });

  test("Claude Code over 967K: it compacts at 967K, before your line, marked on the bar", () => {
    const body = popover({ agent: true, name: "Claude Code", window: 1_100_000, percent: 90, live: { facts: agentFacts(500_000, { at: 967_000, line: 990_000 }, 1_100_000) } }).draw();
    assert.equal(sentenceOf(body), "Claude Code compacts by itself at 967K, before your line (990K).");
    const mark = byClass(body, "inst-cap-point");
    assert.deepEqual([mark.classList.contains("hidden"), mark.attrs.style], [false, "left:87.91%"]);
  });

  // (fails before: yes — HarnessV4_Tasks C26: a session that asks was handed no line, and the sentence said so; it is
  // handed its line either way, and asking is what a message you send does)
  test("Claude Code, asking first: it is handed the line all the same and compacts there by itself mid-turn; a message you send past it asks", () => {
    const point = { at: 170_000, line: 170_000 };
    const body = popover({ agent: true, name: "Claude Code", mode: "ask", live: { facts: agentFacts(50_000, point) } }).draw();
    assert.equal(sentenceOf(body), "120K before your line (170K). Claude Code compacts there by itself, even mid-turn. A message you send past it asks first.");
    assert.equal(sentenceOf(popover({ agent: true, name: "Claude Code", mode: "ask", live: { facts: agentFacts(175_000, point) } }).draw()), "Past your line (170K) — your next message asks how to make room first.");
    // Its own point under a low line is drawn as on Automatic.
    const low = popover({ agent: true, name: "Claude Code", mode: "ask", window: 100_000, percent: 50, live: { facts: agentFacts(20_000, { at: 67_000, line: 50_000 }, 100_000) } }).draw();
    assert.equal(byClass(low, "inst-cap-point").classList.contains("hidden"), false);
    // Mid-turn past the line it took, it makes room by itself: Stop and compact stands beside Compact now…, as while any
    // turn runs, not in its place.
    const running = popover({ agent: true, name: "Claude Code", mode: "ask", live: { facts: agentFacts(50_000, point), streaming: true, liveHeld: 175_000 } }).draw();
    assert.equal(sentenceOf(running), "Past your line (170K) — Claude Code compacts by itself at its next step.");
    assert.deepEqual(labels(running).slice(2, 4), ["Compact now…", "Stop and compact"]);
    // With no line taken yet, its own point stands and the line acts between turns: Stop and compact mid-turn.
    const none = popover({ agent: true, name: "Claude Code", mode: "ask", live: { facts: agentFacts(50_000), streaming: true, liveHeld: 175_000 } }).draw();
    assert.deepEqual(labels(none), ["170K · 85%", "Suggested", "Stop and compact", "How earlier turns are kept"]);
  });

  test("a line moved since Claude's session took one: it takes the new line as a turn starts", () => {
    const body = popover({ agent: true, name: "Claude Code", percent: 50, live: { facts: agentFacts(50_000, { at: 170_000, line: 170_000 }) } }).draw();
    assert.equal(sentenceOf(body), "50K before your line (100K). Claude Code takes your new line as a turn starts.");
    assert.equal(byClass(body, "inst-cap-point").classList.contains("hidden"), true, "the old point is not drawn");
    const running = popover({ agent: true, name: "Claude Code", percent: 50, live: { facts: agentFacts(50_000, { at: 170_000, line: 170_000 }), streaming: true, liveHeld: 120_000 } }).draw();
    assert.equal(sentenceOf(running), "Past your line (100K) mid-turn. Claude Code takes your new line as a turn starts.");
    assert.ok(labels(running).includes("Stop and compact"));
  });

  test("an agent that takes no line: your line acts between turns, it compacts at its own point; past it mid-turn, Stop and compact", () => {
    const body = popover({ agent: true, name: "Codex", live: { facts: agentFacts(50_000) } }).draw();
    assert.equal(sentenceOf(body), "120K before your line (170K). Your line acts between turns. Codex compacts by itself at its own point.");
    const p = popover({ agent: true, name: "Codex", live: { facts: agentFacts(50_000), streaming: true, liveHeld: 175_000 } });
    const running = p.draw();
    assert.equal(sentenceOf(running), "Past your line (170K) mid-turn. It acts between turns; Codex compacts by itself at its own point.");
    buttonsOf(running).find((b) => textOf(b) === "Stop and compact").dispatch("click");
    assert.deepEqual(p.did, ["closed", "stop and compact"]);
  });

  // (fails before: yes — HarnessV4_Tasks U3-6, UX-9: Compact now ran the session's way whatever the cache held; then, U5
  // phase 3, it compacted on a warm cache and opened its own list of ways on a cold one)
  test("an agent's Compact now…: warm cache or cold, it brings up the card, which says what each way reads again; while the agent's turn runs under a line it acts on, it waits for the turn's end", async () => {
    const methods = { fold: { possible: true, after: 30_000, exact: true, cost: 0 }, digest: { possible: false, why: "no" }, trim: { possible: false, why: "no" }, summary: { possible: false, why: "no" } };
    /** @param {number} warmUntil */
    const plan = (warmUntil) => ({ compaction: { native: true, auto: "fold", agent: { chosen: "suggested", way: "own", suggested: true, own: "fork", self: null, weighed: true, held: 120_000, estimated: false, warmUntil }, methods } });
    for (const warmUntil of [Date.now() + 120_000, Date.now() - 1000]) {
      const p = popover({ agent: true, name: "Claude Code", live: { facts: agentFacts(120_000) } });
      p.state.preview = plan(warmUntil);
      const body = p.draw();
      await new Promise((r) => setImmediate(r));
      assert.equal(labels(body)[2], "Compact now…");
      buttonsOf(body).find((b) => textOf(b) === "Compact now…").dispatch("click");
      assert.deepEqual(p.did.filter((d) => d !== "relayout"), ["closed", "summon"]);
    }
    const point = { at: 170_000, line: 170_000 };
    const busy = popover({ agent: true, name: "Claude Code", live: { facts: agentFacts(50_000, point), streaming: true, liveHeld: 60_000 } });
    const body = busy.draw();
    const compact = buttonsOf(body).find((b) => textOf(b) === "Compact now…");
    assert.deepEqual([compact.disabled, compact.attrs.title], [true, "Claude Code compacts its own context as it works — Compact now… opens once its turn ends"]);
    compact.dispatch("click");
    assert.deepEqual(busy.did, [], "nothing while it waits");
  });

  // (fails before: yes — U5 phase 3: the popover said "Filament answers it: Off" where the sheet and the card say
  // "OpenCode's own"; the owner's rules of 10-31: Filament answered a client's compaction where a setting said how, and
  // the popover offered Compact now…)
  test("a client's session: its client compacts by itself, its own model writing the summary — no line to drag, no way of Filament's", () => {
    const off = popover({ client: "OpenCode", live: { facts: loopFacts(64_000) } });
    const body = off.draw();
    assert.equal(sentenceOf(body), "OpenCode compacts by itself; its own model writes the summary.");
    assert.equal(byClass(body, "inst-cap-slider"), null, "no thumb: the client decides when");
    assert.equal(byClass(body, "inst-line-row").classList.contains("hidden"), true, "no line of Filament's");
    assert.deepEqual(labels(body), ["How earlier turns are kept", "Dry run", "Next request"], "nothing of Filament's compacts it");
    assert.equal(isClientView(off.view), true);
    const chosen = popover({ client: "OpenCode", method: "summary", sources: { "context.compaction.method": "session" }, live: { facts: loopFacts(64_000) } });
    assert.equal(sentenceOf(chosen.draw()), "OpenCode compacts by itself; its own model writes the summary.", "a method the session names answers no client");
    assert.deepEqual([sessionMethod(off.view), sessionMethod(chosen.view)], [null, null]);
  });

  test("no window known, or nothing counted yet: the room words as before, no bar", () => {
    const none = popover({ window: 0, live: { facts: { held: 12_000, context: { window: null, usable: null, verdict: null, source: null } } } }).draw();
    assert.equal(sentenceOf(none), "12K tokens held — this model's window isn't known, so there's no line to measure against.");
    assert.equal(byClass(none, "inst-cap-bar").classList.contains("hidden"), true);
    const uncounted = popover({ agent: true, live: { estimate: 4000 } }).draw();
    assert.equal(byClass(uncounted, "inst-lede").classList.contains("hidden"), true, "an agent that has counted nothing has no room to speak of");
    assert.equal(textOf(byClass(uncounted, "inst-meter-head")), "Not counted yet");
  });
});

describe("the line's thumb (U3-2)", () => {
  test("dragging moves the line the sentence reads; letting go writes the session's percent, and nothing with it; a repaint never moves the thumb under the pointer", () => {
    const p = popover({ live: { facts: loopFacts(64_000) } });
    // A target an older Filament stored, under where the line goes: no compaction aims for one now.
    p.view.settings.flat["context.compaction.target"] = 58;
    const body = p.draw();
    const thumb = byClass(body, "inst-cap-slider");
    assert.deepEqual([thumb.attrs.min, thumb.attrs.max, thumb.value], ["15", "95", "85"]);
    thumb.value = "60";
    thumb.dispatch("input", { target: thumb });
    assert.equal(sentenceOf(body), "56K of room before your line (120K). A running turn makes room there and carries on; so does a message you send past it.");
    p.spec.repaint?.();
    assert.equal(thumb.value, "60", "the live figures moving leave the thumb where it is");
    thumb.dispatch("change", { target: thumb });
    // (fails before: yes — the owner's rules of 10-31: a line moved low carried a target under it, which no compaction aims for now)
    assert.deepEqual(p.did, ['write {"patch":{"context":{"compaction":{"thresholdPercent":60}}}}']);
    p.spec.repaint?.();
    assert.equal(sentenceOf(body), "56K of room before your line (120K). A running turn makes room there and carries on; so does a message you send past it.", "until the settings say so, the line let go at stands");
    p.view.settings.flat["context.compaction.thresholdPercent"] = 60;
    p.spec.repaint?.();
    assert.equal(thumb.value, "60");
    // The settings move it elsewhere (another window, /set): the thumb follows.
    p.view.settings.flat["context.compaction.thresholdPercent"] = 75;
    p.spec.repaint?.();
    assert.deepEqual([thumb.value, sentenceOf(body)], ["75", "86K of room before your line (150K). A running turn makes room there and carries on; so does a message you send past it."]);
  });

  // (fails before: yes — U5 phase 3: the line was the thumb alone; the mock labels it, with its stops and a number)
  test("Your line's chip: a number typed in its field — tokens of the window or a percent — moves the thumb and writes the line as letting go does; words that name no line say so", () => {
    const p = popover({ live: { facts: loopFacts(64_000) } });
    p.view.settings.flat["context.compaction.target"] = 58;
    const body = p.draw();
    assert.equal(byClass(body, "inst-line-chip").attrs.title, "Where the chat counts as full: pick a stop, or type a number");
    const field = byClass(body, "inst-line-field");
    field.value = "120k";
    field.dispatch("keydown", { key: "Enter" });
    assert.deepEqual(p.did, ['write {"patch":{"context":{"compaction":{"thresholdPercent":60}}}}'], "the line alone, an old target under it or not");
    assert.deepEqual([byClass(body, "inst-cap-slider").value, chipOf(body)], ["60", "120K · 60%"], "the thumb and the chip go where the line was typed");
    assert.equal(sentenceOf(body), "56K of room before your line (120K). A running turn makes room there and carries on; so does a message you send past it.");
    field.value = "a lot";
    field.dispatch("keydown", { key: "Enter" });
    assert.deepEqual(p.did.slice(1), ["toast A line is a percent of the window (15–95%) or tokens: 40%, 400k"]);
  });
});

describe("the pieces the popover reads", () => {
  test("agentPointOf: the record's, else the facts', else the newest turn's in the view; none without a point", () => {
    const point = { at: 67_000, line: 50_000 };
    assert.deepEqual(agentPointOf(null, { rec: { context: { point } } }), point);
    assert.deepEqual(agentPointOf(null, { facts: { context: { point } } }), point);
    assert.deepEqual(agentPointOf({ facts: { context: { point } } }, { facts: { afterCompaction: true, context: { window: 200_000 } } }), point, "after a compaction, the newest turn's");
    assert.equal(agentPointOf({ facts: { context: {} } }, { rec: null }), null);
    assert.equal(agentPointOf(null, { rec: { context: { point: { at: 0, line: 0 } } } }), null);
  });

  test("lineSentence and stopOffered agree on when the line acts by itself", () => {
    const base = { held: 175_000, line: { tokens: 170_000 }, ask: false, agent: true, who: "Claude Code", running: true };
    for (const [point, offered] of /** @type {[any, boolean][]} */ ([[null, true], [{ at: 170_000, line: 170_000 }, false], [{ at: 200_000, line: 170_000 }, true], [{ at: 150_000, line: 120_000 }, true]])) {
      assert.equal(stopOffered({ ...base, point }), offered, JSON.stringify(point));
      assert.equal(/ mid-turn\./.test(lineSentence({ ...base, point })), offered, lineSentence({ ...base, point }));
    }
    assert.equal(stopOffered({ ...base, point: null, running: false }), false, "between turns the line acts");
    assert.equal(stopOffered({ ...base, point: null, agent: false }), false, "the loop acts on its line mid-turn");
    assert.match(lineSentence({ ...base, held: 50_000, running: false, ask: true, point: { at: 170_000, line: 170_000 } }), /compacts there by itself, even mid-turn\. A message you send past it asks first\.$/, "asking is a message's: the line is handed all the same");
  });

  // Stop and compact is the server's since main's U2 (`onceTurnEnds`): the page asks once and stops the turn; it no
  // longer compacts where it reads the turn's end.
  test("the app wires Stop and compact to its one action, Compact now… to the card, Fold now to the instant fold and How earlier turns are kept to the sheet", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /stopAndCompact: \(\) => stopAndCompact\(\),/);
    assert.match(app, /summon: \(\) => \{ summonCompactionCard\("", \[\]\); \},\n  \/\/ [^\n]+\n  foldNow: \(\) => \{ const c = sessionChat\(\); if \(c && !c\.live\) void compactNow\(c, \{ method: "fold" \}\); \},\n  openHow: \(\) => openHow\(\),/);
    assert.equal((app.match(/function stopAndCompact\(/g) || []).length, 1, "one Stop and compact");
    const fn = app.slice(app.indexOf("function stopAndCompact("), app.indexOf("\n}\n", app.indexOf("function stopAndCompact(")));
    assert.match(fn, /compactNow\(chat, \{ onceTurnEnds: true \}\)/);
    assert.match(fn, /stopCurrent\(\);/);
    assert.equal(app.includes("compactWhenEnded"), false, "the page compacts at no turn's end of its own");
  });
});

// (fails before: yes — HarnessV4_Tasks U3-10: the note read "The agent's own count, as its last turn ended" over a
// figure another agent had counted)
test("after a switch into an agent (U3-10): the note says whose figure it is — Filament's copy, an estimate, with what the fresh start carries", () => {
  const facts = { held: 42_000, context: { window: 400_000, usable: 340_000, verdict: null, source: null, estimated: true }, freshStart: "switch" };
  const p = popover({ agent: true, name: "Codex", window: 400_000, live: { facts } });
  /** @type {any} */ (p.view.settings).effective = { context: { carry: "fold" } };
  const body = p.draw();
  const text = textOf(body);
  assert.ok(text.includes("An estimate: another model answered last, so Codex holds none of this chat yet. Its next turn starts a fresh session from Filament's copy, earlier turns carried as Folded; it adds its own prompt and tools."), text);
  assert.ok(!text.includes("The agent's own count"), text);
  // Whole unless chosen, and the agent named plainly where it has no name.
  const q = popover({ agent: true, window: 400_000, live: { facts } });
  assert.ok(textOf(q.draw()).includes("so the agent holds none of this chat yet. Its next turn starts a fresh session from Filament's copy, earlier turns carried as Whole;"), textOf(q.draw()));
});

// (fails before: yes — the popover seen in a browser on 10-11, HarnessV4_Tasks U3 (V4-D211 to V4-D214): the band the
// line may take was hatched at rest and read as data; the line's figure sat at the bar's left end, far from its thumb,
// and the window was said a third time at its right; "≈" stood twice; an agent with nothing counted showed a dash; how
// the figure is counted took a paragraph; Compact now said "Suggested", no way at all, until the plan came, and "cache
// cold, choose how" over a press that opens the ways; the model was its route id; the loop said "the line" where an
// agent's session said "your line", and put its method in brackets the button below already names; then, U5 phase 3,
// the line's figure under its thumb gave way to the chip under the bar)
describe("the popover as a browser shows it (V4-D211 to V4-D214)", () => {
  test("the bar: the line's band shows only while the line is handled; its chip says the line and follows the thumb; the window is said once", () => {
    const p = popover({ live: { facts: loopFacts(64_000) } });
    const body = p.draw();
    const bar = byClass(body, "inst-cap-bar");
    assert.equal(chipOf(body), "170K · 85%", "no window figure on the line: the header and the figure say it");
    assert.equal(bar.classList.contains("is-moving"), false);
    const thumb = byClass(body, "inst-cap-slider");
    thumb.value = "60";
    thumb.dispatch("input", { target: thumb });
    assert.equal(bar.classList.contains("is-moving"), true, "the band shows while the thumb moves");
    assert.equal(chipOf(body), "120K · 60%", "the chip follows the thumb");
    thumb.dispatch("change", { target: thumb });
    assert.equal(bar.classList.contains("is-moving"), false);
    const css = readFileSync(new URL("../src/ui/harness/instruments.css", import.meta.url), "utf8");
    assert.match(css, /\.inst-cap-zone \{[^}]*opacity: 0;/, "the band is not drawn at rest");
    assert.match(css, /\.inst-cap-bar:hover \.inst-cap-zone,\s*\.inst-cap-bar:focus-within \.inst-cap-zone,\s*\.inst-cap-bar\.is-moving \.inst-cap-zone \{ opacity: 1; \}/);
    // An agent's own point is said by the sentence and the mark's title; the chip keeps the line's figure alone.
    const point = popover({ agent: true, name: "Claude Code", window: 100_000, percent: 50, live: { facts: agentFacts(20_000, { at: 67_000, line: 50_000 }, 100_000) } }).draw();
    assert.equal(chipOf(point), "50K · 50%");
    assert.equal(byClass(point, "inst-cap-point").attrs.title, "Claude Code compacts by itself here, at 67K");
  });

  test("the figure: ≈ once, on the big number; nothing counted is said in words; how the figure is counted is its title, not a paragraph", () => {
    const ended = popover({ agent: true, name: "Claude Code", live: { facts: agentFacts(50_000) } }).draw();
    const head = byClass(ended, "inst-meter-head");
    assert.equal(textOf(head), "25|%|50K of 200K");
    assert.equal(head.attrs.title, "The agent's own count, as its last turn ended.");
    assert.doesNotMatch(textOf(ended), /The agent's own count/, "not in the popover's body");
    const running = popover({ agent: true, name: "Claude Code", live: { facts: agentFacts(50_000), streaming: true, liveHeld: 60_000 } }).draw();
    const now = byClass(running, "inst-meter-head");
    assert.equal(textOf(now), "≈30|%|60K of 200K", "the big number carries the ≈; the tokens under it do not say it again");
    assert.equal(now.attrs.title, "The agent's own count as of its newest model call, and what it has written since. Its count at the turn's end replaces it.");
    assert.doesNotMatch(textOf(running), /The agent's own count/);
    const loop = popover({ live: { facts: loopFacts(64_000), streaming: true, liveHeld: 70_000 } }).draw();
    assert.equal(byClass(loop, "inst-meter-head").attrs.title, "An estimate while the turn runs — the loop's own measure of what it sends. The provider's exact count replaces it when the turn ends.");
    assert.doesNotMatch(textOf(loop), /An estimate while the turn runs/);
    // Nothing counted: the words take the number's place; the note says when a count comes.
    const none = popover({ agent: true, live: { estimate: 4000 } }).draw();
    assert.equal(textOf(byClass(none, "inst-meter-head")), "Not counted yet");
    assert.equal(byClass(none, "inst-ring-num").classList.contains("is-words"), true);
    assert.ok(textOf(none).includes("The agent counts its context after its first model call."), textOf(none));
    assert.doesNotMatch(textOf(none), /—\|/, "no dash standing for a number");
    // What a person needs to act on stays in the body: Filament's copy after a switch, a compaction that named nothing.
    const unsaid = popover({ agent: true, name: "Codex", live: { facts: { held: 0, context: { window: 200_000, usable: null, verdict: null, source: "agent" }, afterCompaction: true, unsaid: true } } }).draw();
    assert.ok(textOf(unsaid).includes("The agent compacted its context and didn't say what it holds now — it counts again at its next turn."));
  });

  test("Compact now… says what a press does — it brings up the card — never \"Suggested\", whatever way the session chose", () => {
    for (const way of [undefined, "own", "ours"]) assert.equal(labels(popover({ agent: true, name: "Codex", ...(way ? { way } : {}), live: { facts: agentFacts(50_000) } }).draw())[2], "Compact now…", String(way));
  });

  test("one name for one thing: the model as the composer's chip names it; \"your line\" in Filament's sessions too", () => {
    const body = popover({ live: { facts: loopFacts(64_000) } }).draw();
    // The head's line holds the popover's own (its title on it).
    const sub = byClass(body, "inst-sub").kids[0];
    assert.equal(textOf(sub), "Opus · 200K window", "a model the page's list has no label for: its name, as the chip says it");
    assert.match(String(sub.attrs.title), /^opus — /, "the route in its title");
    assert.equal(textOf(byClass(popover({ models: [{ id: "opus", label: "Opus 5.5" }], live: { facts: loopFacts(64_000) } }).draw(), "inst-sub")), "Opus 5.5 · 200K window");
    assert.ok(textOf(body).includes("Room to your line|106K"));
  });
});

// (fails before: yes — the Designer's review of 10-24: how room is made and whether a message past the line asks were
// behind the sheet's link, and that the window is every chat's on the model was said nowhere)
describe("the popover's choices in place (the design pass of 10-24)", () => {
  /** A row of the small table under the bar, by its name. @param {any} body @param {string} name */
  const setRow = (body, name) => find(body, (n) => String(n.attrs?.class || "") === "inst-set-row" && textOf(n).startsWith(name));

  // (fails before: yes — the owner's rules of 10-31: it offered Least lossy and five methods; it offers the three kinds)
  test("Makes room by names the session's kind; it offers the three kinds, or an agent's ways, as the sheet and the card name them", () => {
    assert.equal(textOf(setRow(popover({ method: "fold", live: { facts: loopFacts(64_000) } }).draw(), "Makes room by")), "Makes room by|Instant fold");
    const side = popover({ live: { facts: loopFacts(64_000) } });
    side.view.settings.flat["context.compaction.writer"] = "model";
    assert.equal(textOf(setRow(side.draw(), "Makes room by")), "Makes room by|Side model", "a side model chosen to write");
    assert.equal(textOf(setRow(popover({ live: { facts: loopFacts(64_000) } }).draw(), "Makes room by")), "Makes room by|Same model", "nothing chosen and no model named: the same model writes");
    assert.equal(textOf(setRow(popover({ agent: true, name: "Codex", way: "own", live: { facts: agentFacts(50_000) } }).draw(), "Makes room by")), "Makes room by|Codex's own compaction");
    const ctx = { view: () => ({ settings: { flat: {} } }), live: () => ({}), accounts: { session: () => ({ agentName: "Codex" }) } };
    const cp = compactionParts(/** @type {any} */ (ctx));
    assert.deepEqual(roomChoices(cp, false).map((c) => [c.label, c.patch]), [["Same model", { method: "summary", writer: "session" }], ["Side model", { method: "summary", writer: "model" }], ["Instant fold", { method: "fold" }]]);
    assert.deepEqual(roomChoices(cp, true).map((c) => [c.label, c.patch.agent]), [["Suggested", "suggested"], ["Codex's own compaction", "own"], ["Codex writes a summary", "self"], ["Filament's copy", "ours"]]);
    assert.ok(roomChoices(cp, false).every((c) => c.desc), "each with its line");
  });

  test("Ask before making room: the switch says the session's mode and writes it, and holds what was put until the settings say it; a client's session has neither row", () => {
    const p = popover({ mode: "ask", live: { facts: loopFacts(64_000) } });
    const body = p.draw();
    const sw = find(setRow(body, "Ask before making room"), (n) => n.tag === "input");
    assert.equal(sw.checked, true);
    sw.checked = false;
    sw.dispatch("change", { target: sw });
    assert.deepEqual(p.did, ['write {"patch":{"context":{"compaction":{"mode":"auto"}}}}']);
    p.spec.repaint?.();
    assert.equal(sw.checked, false, "a repaint before the settings land leaves it where it was put");
    p.view.settings.flat["context.compaction.mode"] = "auto";
    p.spec.repaint?.();
    assert.equal(sw.checked, false);
    p.view.settings.flat["context.compaction.mode"] = "ask";
    p.spec.repaint?.();
    assert.equal(sw.checked, true, "the settings move it elsewhere: it follows");
    assert.equal(find(popover({ client: "OpenCode", live: { facts: loopFacts(64_000) } }).draw(), (n) => n.attrs?.class === "inst-set-row"), null);
  });

  test("the window is the model's: the foot says every chat on it shares it, and Change… opens the field with where its figure came from", () => {
    const p = popover({ live: { facts: loopFacts(64_000) } });
    /** @type {any} */ (p.view.settings.window).settable = true;
    const body = p.draw();
    const scope = byClass(body, "inst-scope");
    assert.equal(scope.classList.contains("hidden"), false);
    assert.equal(textOf(byClass(scope, "inst-scope-text")), "Every chat on Opus shares this window");
    assert.equal(byClass(body, "inst-window"), null, "no field until Change… is pressed");
    const change = buttonsOf(scope).find((b) => textOf(b) === "Change…");
    change.dispatch("click");
    const box = byClass(body, "inst-window");
    assert.equal(textOf(box.kids[0]), "Opus's window is 200,000 tokens (from its upstream's model card). Say another and every chat on this model takes yours.");
    assert.deepEqual(buttonsOf(box).filter((b) => !b.classList.contains("hidden")).map(textOf), ["Change"]);
    assert.equal(change.classList.contains("hidden"), true);
    // A window nobody may say here, or one the agent named: no line at the foot.
    assert.equal(byClass(popover({ live: { facts: loopFacts(64_000) } }).draw(), "inst-scope").classList.contains("hidden"), true);
    const named = popover({ agent: true, name: "Claude Code", live: { facts: agentFacts(50_000) } });
    /** @type {any} */ (named.view.settings.window).settable = true;
    assert.equal(byClass(named.draw(), "inst-scope").classList.contains("hidden"), true);
  });
});
