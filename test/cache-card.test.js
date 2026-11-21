// @ts-check
// The Cache chip and its card draw what is known and no more (the owner's of 11-11: a chat on Cursor, whose usage
// gives no cache numbers, drew "Cache 0% warm 5 min", a ring at 0%, "Warm · 4:36 left", "Session average 0%", "Saved
// so far $0.00", a forecast for its next turn and six dashes for its six turns, beside a Spend of "$0.00" nothing had
// priced; "an edge case mid sessions models can be switched"). Each case is driven through the widgets' own DOM, as
// the frame draws it from the session's view: the ledger (`settings.usage`), the turns' facts, the running turn's calls.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { featureWidget } from "../src/ui/harness/widgets/frame.js";
import { cacheWidget, callOf } from "../src/ui/harness/widgets/cache.js";
import { spendWidget } from "../src/ui/harness/widgets/spend.js";
import { tokensWidget } from "../src/ui/harness/widgets/overview-sofar.js";
import { factsLine } from "../src/ui/harness/lib/labels.js";
import { tok } from "../src/ui/harness/widgets/kit.js";
import { KNOBS } from "../src/services/session-settings.js";
import { fakeH, fakeDrawIn, textOf, recordingPopover } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";

const NOW = Date.now();
const io = { h: fakeH, drawIn: fakeDrawIn };

/**
 * A widget context over a fixed session view, every action a no-op.
 * @param {any} view @param {Record<string, any>} [over]
 * @returns {import("../src/ui/harness/widgets/registry.js").WidgetContext}
 */
const ctxOf = (view, over = {}) => /** @type {any} */ ({
  view: () => view,
  hasSession: () => true,
  knobs: () => KNOBS,
  models: () => [],
  live: () => ({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false }),
  turns: () => [],
  setWindow: () => {},
  write: () => {},
  command: () => {},
  openPage: () => {},
  openPane: () => {},
  memoryEngine: () => null,
  toast: () => {},
  preview: async () => null,
  scrollToTurn: () => false,
  subagents: { rows: () => [], models: () => [], sessionModel: () => "m", cache: () => ({ state: "none", running: false, leftMs: 0, ttlMs: 0, tokens: 0, model: null }) },
  accounts: { session: () => null, check: async () => {}, useResetCredit: async () => null, rows: () => [], signIn: () => {}, switchTo: () => {}, manage: () => {} },
  ...over,
});

/**
 * A widget as the composer's strip holds it: its chip, whether the strip shows it, its words there (its name, its
 * figure, the words after it), and its card as a press on the chip opens it.
 * @param {import("../src/ui/harness/widgets/frame.js").WidgetSpec} spec
 */
const chipOf = (spec) => {
  const { popover, pops } = recordingPopover();
  const frame = /** @type {any} */ (featureWidget(spec, { ...io, popover, rows: () => [] }));
  return {
    frame,
    shown: () => !frame.el.classList.contains("hidden"),
    words: () => textOf(frame.el).split("|").filter(Boolean).join(" "),
    card: () => {
      frame.el.dispatch("click");
      return textOf(pops.at(-1)?.body);
    },
  };
};
/** The card as Overview's tile opens it, whether the strip shows the chip or not. @param {import("../src/ui/harness/widgets/frame.js").WidgetSpec} spec */
const cardOf = (spec) => /** @type {any} */ (spec.panel?.(fakeH, () => {}));
/** The tile's words on Overview. @param {import("../src/ui/harness/widgets/frame.js").WidgetSpec} spec */
const tileOf = (spec) => textOf(fakeH("div", {}, .../** @type {any[]} */ ([spec.tile?.(fakeH, "S", { open: () => {} })].flat())));
/** The columns of the card's "Hit rate by turn": each one's tooltip, and whether it is a gap, a stub at 0 or a bar. @param {any} card */
const columnsOf = (card) =>
  (card.querySelector("inst-bars")?.kids || [])
    .filter((/** @type {any} */ k) => !String(k.attrs?.class || "").includes("is-ghost"))
    .map((/** @type {any} */ k) => [k.attrs.title, /\bis-gap\b/.test(k.attrs.class) ? "gap" : /\bis-empty\b/.test(k.attrs.class) ? "zero" : "bar"]);

/** A turn's facts as the fold keeps them. @param {number} n @param {any} tokens @param {any} [over] */
const turn = (n, tokens, over = {}) => ({ n, facts: { tokens, held: (tokens.input || 0) + (tokens.cacheRead || 0) + (tokens.cacheWrite || 0), ...over } });
const settingsOf = (/** @type {any} */ usage, /** @type {any} */ cache) => ({ settings: { usage, cache, effective: { context: { results: "keep" } }, price: null } });
const agentLive = (/** @type {any} */ over = {}) => ({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false, agent: true, call: null, ...over });

// A chat on Cursor's CLI, as the owner's stood: six turns, each an estimate of Filament's — no usage from the agent, so
// no cache numbers and no price.
const CURSOR_TURNS = [1, 2, 3, 4, 5, 6].map((n) => turn(n, { input: 1400, output: 300, cacheRead: 0, cacheWrite: 0 }, { model: "auto", upstream: "cursor", costUsd: null, listUsd: null }));
const CURSOR_USAGE = Object.freeze({ usd: 0, listUsd: 0, listUnpriced: 6, requests: 6, input: 8400, output: 1800, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, savedUsd: 0, unpriced: 6, turns: 6, agents: { usd: 0, listUsd: 0, requests: 0, before: 0 }, teams: { usd: 0, listUsd: 0, runs: 0 }, byModel: { auto: { usd: 0, listUsd: 0, requests: 6, inputTokens: 8400, outputTokens: 1800, cacheReadTokens: 0, cacheWriteTokens: 0, unpricedRequests: 6, listUnpricedRequests: 6 } }, last: { at: NOW - 24_000, usd: 0, listUsd: 0, model: "auto", input: 1400, output: 300, cacheRead: 0, cacheWrite: 0, cacheSeen: false, savedUsd: 0, unpriced: 1, upstream: "cursor" } });
// A chat on Claude Code: every call says what it read and wrote, and its writes' lifetime (an hour's, on a plan).
const CLAUDE_TURNS = [
  turn(1, { input: 50, output: 200, cacheRead: 0, cacheWrite: 20_000, cacheSeen: 20_050 }, { model: "claude-sonnet-5", upstream: "claude-code", costUsd: 0, listUsd: 0.08 }),
  turn(2, { input: 40, output: 300, cacheRead: 20_000, cacheWrite: 1000, cacheSeen: 21_040 }, { model: "claude-sonnet-5", upstream: "claude-code", costUsd: 0, listUsd: 0.02 }),
  turn(3, { input: 100, output: 200, cacheRead: 30_000, cacheWrite: 900, cacheSeen: 31_000 }, { model: "claude-sonnet-5", upstream: "claude-code", costUsd: 0, listUsd: 0.02 }),
];
const claudeUsage = (/** @type {number} */ at) => ({ usd: 0, listUsd: 0.12, listUnpriced: 0, requests: 3, input: 190, output: 700, cacheRead: 50_000, cacheWrite: 21_900, cacheSeen: 72_090, savedUsd: 0.8, unpriced: 0, turns: 3, last: { at, model: "claude-sonnet-5", input: 100, cacheRead: 30_000, cacheWrite: 900, cacheSeen: true, ttlMs: 3_600_000, upstream: "claude-code" } });

describe("a chat whose agent gives no cache numbers", () => {
  // (fails before: yes — the chip read "Cache 0% warm 5 min" and its card a ring at 0%, a clock, an average, savings and
  // a forecast, each an unknown drawn as a figure)
  test("shows no Cache chip, and Overview keeps no Cache tile: nothing claims 0%, a warm clock or a forecast", () => {
    const spec = cacheWidget(ctxOf(settingsOf(CURSOR_USAGE, { ttl: "5m", from: "rules", settable: false }), { turns: () => CURSOR_TURNS, live: () => agentLive() }), io);
    const chip = chipOf(spec);
    assert.equal(chip.shown(), false, `the strip shows no Cache chip, where it read "${chip.words()}"`);
    assert.equal(spec.empty?.(), true, "and Overview keeps its tile off: no turn of the chat said any");
    assert.equal(spec.more?.(), "", "no words after a figure it has not");
    assert.doesNotMatch(String(spec.title?.()), /0%|warm|cold/i);
  });

  // (fails before: yes — "$0.00", where every request of the chat was unpriced: its agent's plan paid, and nothing said what)
  test("shows no Spend chip while none of its requests has a price: the total is not known, never $0.00", () => {
    const spec = spendWidget(ctxOf(settingsOf(CURSOR_USAGE, null), { turns: () => CURSOR_TURNS, live: () => agentLive() }), io);
    const chip = chipOf(spec);
    assert.equal(chip.shown(), false, `the strip shows no Spend chip, where it read "${chip.words()}"`);
    assert.equal(spec.title?.(), "Spend: not priced — none of this chat's 6 requests named a price");
    const tile = tileOf(spec);
    assert.ok(tile.includes("—") && tile.includes("6 requests, none priced") && !tile.includes("$0.00"), tile);
    const card = textOf(cardOf(spec));
    assert.ok(!card.includes("Saved by the cache") && !card.includes("read from cache"), `no cache figures on its card: ${card}`);
    assert.ok(card.includes("6 unpriced") && card.includes("Tokens processed"), card);
    // A chat a plan paid for, at a price its card knows: $0.00 is what it paid, and is said.
    const plan = spendWidget(ctxOf(settingsOf(claudeUsage(NOW - 90_000), null), { turns: () => CLAUDE_TURNS }), io);
    assert.equal(chipOf(plan).shown(), true);
    assert.equal(plan.state(), "$0.00");
    assert.ok(textOf(cardOf(plan)).includes("Saved by the cache"), "and its cache's savings, which its requests' numbers say");
    // A new chat has spent nothing: that is known.
    assert.equal(chipOf(spendWidget(ctxOf(settingsOf({ usd: 0, requests: 0, unpriced: 0 }, null)), io)).shown(), true);
  });

  // (fails before: yes — "0 read from its cache, 0 written to it" under each turn, and "From cache 0 tokens" on Overview)
  test("its turns' footers and Overview's Tokens tile say what went out, and nothing of a cache", () => {
    const sent = factsLine(CURSOR_TURNS[0].facts).find((s) => s.id === "sent");
    assert.deepEqual([sent?.text, sent?.title], ["sent 1,400", "1,400 tokens went out; this turn's usage gave no cache numbers"]);
    const said = factsLine(CLAUDE_TURNS[2].facts).find((s) => s.id === "sent");
    assert.deepEqual([said?.text, said?.title], ["sent 31,000 (cache 97%)", "31,000 tokens went out, the prompt as the provider counted it; 30,000 read from its cache, 900 written to it (100 fresh)"]);
    const tokens = tokensWidget(ctxOf(settingsOf(CURSOR_USAGE, null), { turns: () => CURSOR_TURNS }));
    const tile = tileOf(tokens);
    assert.ok(tile.includes(tok(10_200)) && !/cache/i.test(tile), tile);
    const counted = tokensWidget(ctxOf(settingsOf(claudeUsage(NOW), null), { turns: () => CLAUDE_TURNS }));
    assert.ok(tileOf(counted).includes("69% read back from cache"), tileOf(counted));
    // Its back's rows are drawn with the page's own `h`: a document stands in for them.
    const doc = stubDocument();
    try {
      assert.doesNotMatch(String(tokens.now?.().textContent), /cache/i, "nor its back's rows");
      assert.match(String(tokens.now?.().textContent), /New in.*8,400 tokens.*Out.*1,800 tokens.*Requests.*6/);
      assert.match(String(counted.now?.().textContent), /From cache.*50,000 tokens.*Into cache.*21,900 tokens/);
    } finally {
      doc.restore();
    }
  });
});

describe("a chat whose agent says its cache numbers", () => {
  // (fails before: yes — the ledger's last request kept no lifetime, so an hour's cache read "Five-minute prompt cache"
  // once the page was opened again)
  test("shows the chip and the whole card: the newest request's share, the clock of the lifetime its own calls said, the forecast", async () => {
    const view = settingsOf(claudeUsage(NOW - 90_000), { ttl: "5m", from: "rules", settable: false, same: { at: NOW - 90_000, is: true } });
    const spec = cacheWidget(ctxOf(view, { turns: () => CLAUDE_TURNS, live: () => agentLive() }), io);
    const chip = chipOf(spec);
    assert.equal(chip.shown(), true);
    assert.equal(chip.words(), "Cache 97% warm 59 min");
    assert.equal(spec.empty?.(), false);
    const card = chip.card();
    await new Promise((r) => setTimeout(r, 0));
    for (const bit of ["Cache", "One-hour prompt cache", "97|%", "last request", "Warm · 58:", "Session average", "69%", "Saved so far", "$0.80", "Cache lifetime", "Set by the agent's own requests", "1 hour", "Next turn", "~100%", "The agent keeps its conversation whole between turns", "Last request", "31K tokens", "Hit rate by turn", "3 turns"]) assert.ok(card.includes(bit), `${bit} in ${card}`);
    assert.deepEqual(columnsOf(cardOf(spec)), [["Turn 1: 0% from cache", "zero"], ["Turn 2: 95% from cache", "bar"], ["Turn 3: 97% from cache", "bar"]], "a cold start is a counted 0%");
  });

  // (fails before: yes — "Cache 93% warm 5 min", "Five-minute prompt cache" and a forecast for an agent whose cache's
  // life nothing says: Antigravity's, its figures as agy_acp_server 1.4.5 sent them and the reader now takes them)
  test("and nothing says how long its cache is kept: the share, the split and the turns, with no clock and no forecast", () => {
    const usage = { usd: 0, listUsd: 0.4, listUnpriced: 0, requests: 3, input: 21_737, output: 88, cacheRead: 48_401, cacheWrite: 0, cacheSeen: 70_138, savedUsd: 0.1, unpriced: 0, turns: 3, last: { at: NOW - 20_000, model: "gemini-3.8-flash", input: 2585, output: 21, cacheRead: 33_184, cacheWrite: 0, cacheSeen: true, upstream: "antigravity-acp" } };
    const turns = [turn(1, { input: 17_096, output: 9, cacheRead: 0, cacheWrite: 0, cacheSeen: 17_096 }), turn(2, { input: 2056, output: 58, cacheRead: 15_217, cacheWrite: 0, cacheSeen: 17_273 }), turn(3, { input: 2585, output: 21, cacheRead: 33_184, cacheWrite: 0, cacheSeen: 35_769 })];
    const spec = cacheWidget(ctxOf(settingsOf(usage, { ttl: "5m", from: "rules", settable: false, same: { at: NOW - 20_000, is: true } }), { turns: () => turns, live: () => agentLive() }), io);
    const chip = chipOf(spec);
    assert.equal(chip.words(), "Cache 93%", "the share alone: no warm minutes");
    const card = chip.card();
    for (const bit of ["Prompt cache", "93|%", "last request", "Session average", "69%", "Nothing says how long this cache is kept, so there is no countdown and no forecast.", "Last request", `${tok(35_769)} tokens`, "Hit rate by turn"]) assert.ok(card.includes(bit), `${bit} in ${card}`);
    for (const bit of ["Five-minute", "One-hour", "Warm", "Cold", "Next turn", "left"]) assert.ok(!card.includes(bit), `no "${bit}" in ${card}`);
    assert.deepEqual(columnsOf(cardOf(spec)).map((c) => c[0]), ["Turn 1: 0% from cache", "Turn 2: 88% from cache", "Turn 3: 93% from cache"]);
    assert.doesNotMatch(tileOf(spec), /Warm|Cold|left/);
  });

  // (fails before: yes — the owner's of 11-12: "after i upgraded filament i see this Cache 100% instead of it showing
  // Cold" — a chat on Claude Code whose last request the Filament before had booked, with no lifetime: three and a half
  // hours on the chip stood lit at 100%, its card saying only that nothing says how long the cache is kept)
  test("and nothing says how long its cache is kept, on a coding agent: no clock inside the longest any cache is kept, and gone cold past it", () => {
    // The ledger's last request as that Filament kept it: its figures, and neither a lifetime nor where it went.
    const usage = (/** @type {number} */ at) => ({ usd: 2564.45, listUsd: 2564.45, listUnpriced: 0, requests: 884, input: 9000, output: 4000, cacheRead: 900_000, cacheWrite: 20_000, savedUsd: 100, unpriced: 0, turns: 3, last: { at, model: "claude-fable-5-2[1m]-xhigh", input: 2, cacheRead: 105_983, cacheWrite: 386 } });
    const AGENT = { ttl: "5m", from: "rules", settable: false, atMost: 3_600_000 };
    const view = settingsOf(usage(NOW - 20 * 60_000), AGENT);
    const live = agentLive();
    const spec = cacheWidget(ctxOf(view, { turns: () => CLAUDE_TURNS, live: () => live }), io);
    const chip = chipOf(spec);
    assert.equal(chip.words(), "Cache 100%", "twenty minutes on: five minutes' cache is gone and an hour's is not, and nothing says which it was");
    assert.equal(chip.frame.el.classList.contains("cold"), false);
    assert.ok(chip.card().includes("Nothing says how long this cache is kept, so there is no countdown and no forecast."));
    // Three hours and thirty-four minutes on: past the hour no provider keeps a cache beyond.
    view.settings.usage = usage(NOW - 214 * 60_000);
    chip.frame.paint();
    assert.equal(chip.words(), "Cache 100% gone cold");
    assert.equal(chip.frame.el.classList.contains("cold"), true, "dimmed: the figure is the last request's, and the next turn reads none of it");
    assert.equal(spec.title?.(), "Cache: cold — idle 3 h 34 min — the last request read 100% of its prompt from the provider's cache; the next turn writes it again");
    const card = chip.card();
    for (const bit of ["Prompt cache", "100|%", "last request", "Cold — idle 3 h 34 min", "This request ran 3 h 34 min ago, and no provider keeps a prompt cache longer than 1 h: it has gone cold, so the next turn writes the whole prompt again.", "Last request", `${tok(106_371)} tokens`]) assert.ok(card.includes(bit), `${bit} in ${card}`);
    for (const bit of ["Nothing says", "Warm", "left", "Five-minute", "One-hour"]) assert.ok(!card.includes(bit), `no "${bit}" in ${card}`);
    const tile = tileOf(spec);
    assert.ok(tile.includes("Cold") && tile.includes("idle 3 h 34 min") && !tile.includes("No countdown"), tile);
    // A turn running reads the cache as it goes: what it reads cold it writes again, and its calls say the rest.
    live.streaming = true;
    live.usedAt = NOW - 1000;
    chip.frame.paint();
    assert.equal(chip.words(), "Cache 100%");
    assert.equal(chip.frame.el.classList.contains("cold"), false);
    live.streaming = false;
    // A lifetime its calls said is the clock, not the bound: five minutes' cache is cold at six.
    view.settings.usage = { ...usage(NOW - 6 * 60_000), last: { ...usage(NOW - 6 * 60_000).last, cacheSeen: true, ttlMs: 300_000, upstream: "claude-code" } };
    chip.frame.paint();
    assert.equal(chip.words(), "Cache 100% gone cold");
    assert.match(String(spec.title?.()), /^Cache: cold — expired 1 min ago — /);
    // With no bound said — a provider that caches by itself — nothing is claimed, however long ago.
    view.settings.usage = usage(NOW - 214 * 60_000);
    view.settings.cache = { ttl: "5m", from: "rules", settable: false };
    chip.frame.paint();
    assert.equal(chip.words(), "Cache 100%");
    assert.equal(chip.frame.el.classList.contains("cold"), false);
  });

  // (fails before: yes — a request that read and wrote nothing drew "Warm · 4:40 left" and a forecast of 0% "from cache")
  test("and its newest request touched no cache: a counted 0%, and no clock for a cache nothing was put in", () => {
    const usage = { usd: 0.01, requests: 1, input: 700, output: 30, cacheRead: 0, cacheWrite: 0, cacheSeen: 700, savedUsd: 0, unpriced: 0, turns: 1, last: { at: NOW - 20_000, model: "m", input: 700, output: 30, cacheRead: 0, cacheWrite: 0, cacheSeen: true, upstream: "u" } };
    const spec = cacheWidget(ctxOf(settingsOf(usage, { ttl: "5m", from: "rules", settable: true, same: { at: NOW - 20_000, is: true } }), { turns: () => [turn(1, { input: 700, output: 30, cacheRead: 0, cacheWrite: 0, cacheSeen: 700 })] }), io);
    const chip = chipOf(spec);
    assert.equal(chip.words(), "Cache 0%");
    const card = chip.card();
    assert.ok(card.includes("This request read nothing from the cache and wrote nothing to it."), card);
    for (const bit of ["Warm", "Cold", "Next turn"]) assert.ok(!card.includes(bit), `no "${bit}" in ${card}`);
  });
});

describe("a chat that moved to another model or agent mid-session", () => {
  // Three turns on Claude Code, then two on Cursor's CLI.
  const turns = [...CLAUDE_TURNS, turn(4, { input: 9000, output: 300, cacheRead: 0, cacheWrite: 0 }, { model: "auto", upstream: "cursor" }), turn(5, { input: 9400, output: 200, cacheRead: 0, cacheWrite: 0 }, { model: "auto", upstream: "cursor" })];
  const usage = { ...claudeUsage(NOW - 30_000), requests: 5, input: 18_590, output: 1200, unpriced: 2, listUnpriced: 2, turns: 5, last: { at: NOW - 30_000, usd: 0, listUsd: 0, model: "auto", input: 9400, output: 200, cacheRead: 0, cacheWrite: 0, cacheSeen: false, savedUsd: 0, unpriced: 1, upstream: "cursor" } };

  // (fails before: yes — "Cache 0% warm 5 min" again, the session average sunk by turns that said nothing (55%, of 72K
  // tokens that came with numbers and 18K that did not), and two dashes at 0% for the two Cursor turns)
  test("numbers, then none: the chip goes with the first request that gives none; Overview keeps the earlier turns' record, said as theirs", () => {
    const spec = cacheWidget(ctxOf(settingsOf(usage, { ttl: "5m", from: "rules", settable: false, same: { at: NOW - 30_000, is: true } }), { turns: () => turns, live: () => agentLive() }), io);
    const chip = chipOf(spec);
    assert.equal(chip.shown(), false, `no chip for a request that gave no numbers, where it read "${chip.words()}"`);
    assert.equal(spec.empty?.(), false, "Overview keeps the tile: earlier turns said theirs");
    const tile = tileOf(spec);
    assert.ok(tile.includes("No cache numbers") && tile.includes("for the newest request") && tile.includes("Earlier turns: 69% from cache"), tile);
    assert.doesNotMatch(tile, /Warm|Cold|left|0%/);
    const card = cardOf(spec);
    const text = textOf(card);
    for (const bit of ["Cache", "No cache numbers for the newest request", "The newest request gave no cache numbers. What follows is from the earlier turns that did.", "Earlier turns", "Average where reported", "69%", "Saved by the cache", "$0.80", "Hit rate by turn", "5 turns"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
    for (const bit of ["last request", "Last request", "Warm", "Cold", "Next turn", "Five-minute", "One-hour", "Session average", "55%", "Cache lifetime"]) assert.ok(!text.includes(bit), `no "${bit}" in ${text}`);
    assert.deepEqual(columnsOf(card), [["Turn 1: 0% from cache", "zero"], ["Turn 2: 95% from cache", "bar"], ["Turn 3: 97% from cache", "bar"], ["Turn 4: no cache numbers", "gap"], ["Turn 5: no cache numbers", "gap"]], "a turn that gave none is a gap, never a column at 0%");
  });

  // (fails before: yes — the chat's first Claude request drew among two "0%" columns, under an average of 0% that
  // counted the Cursor turns' tokens as read from nowhere)
  test("none, then numbers: the chip is there from the first request that says them, its average and its turns those that did", async () => {
    const before = [turn(1, { input: 9000, output: 300, cacheRead: 0, cacheWrite: 0 }), turn(2, { input: 9400, output: 200, cacheRead: 0, cacheWrite: 0 })];
    const cursor = { usd: 0, requests: 2, input: 18_400, output: 500, cacheRead: 0, cacheWrite: 0, savedUsd: 0, unpriced: 2, listUnpriced: 2, turns: 2, last: { at: NOW - 600_000, model: "auto", input: 9400, output: 200, cacheRead: 0, cacheWrite: 0, cacheSeen: false, upstream: "cursor" } };
    const view = settingsOf(cursor, { ttl: "5m", from: "rules", settable: false, same: { at: NOW - 600_000, is: true } });
    let shown = before;
    const spec = cacheWidget(ctxOf(view, { turns: () => shown, live: () => agentLive() }), io);
    const chip = chipOf(spec);
    assert.equal(chip.shown(), false);
    // Its first turn on Claude Code is booked: a cold start, which read nothing and wrote the cache.
    shown = [...before, turn(3, { input: 50, output: 200, cacheRead: 0, cacheWrite: 20_000, cacheSeen: 20_050 })];
    view.settings.usage = { ...cursor, requests: 3, input: 18_450, cacheWrite: 20_000, cacheSeen: 20_050, listUnpriced: 2, last: { at: NOW - 90_000, model: "claude-sonnet-5", input: 50, cacheRead: 0, cacheWrite: 20_000, cacheSeen: true, ttlMs: 3_600_000, upstream: "claude-code" } };
    chip.frame.paint();
    assert.equal(chip.shown(), true);
    assert.equal(chip.words(), "Cache 0% warm 59 min", "counted: it read none of its prompt, and wrote the cache its next reads");
    const card = chip.card();
    await new Promise((r) => setTimeout(r, 0));
    for (const bit of ["One-hour prompt cache", "0|%", "last request", "Warm · 58:", "Average where reported", "Next turn", "~100%", "Last request", `${tok(20_050)} tokens`]) assert.ok(card.includes(bit), `${bit} in ${card}`);
    assert.ok(!card.includes("Session average"), "38K tokens came with no numbers: the average is of those that did, and says so");
    assert.deepEqual(columnsOf(cardOf(spec)), [["Turn 1: no cache numbers", "gap"], ["Turn 2: no cache numbers", "gap"], ["Turn 3: 0% from cache", "zero"]]);
  });

  // (fails before: yes — "Cache 97% warm 59 min" and "Next turn ~100% from cache" for a turn another agent answers)
  test("moved, and no request yet where it moved to: the last request's share stays, dimmed, with no clock and no forecast — its cache is not the next turn's", () => {
    const view = settingsOf(claudeUsage(NOW - 90_000), { ttl: "5m", from: "rules", settable: false, same: { at: NOW - 90_000, is: false } });
    const spec = cacheWidget(ctxOf(view, { turns: () => CLAUDE_TURNS, live: () => agentLive() }), io);
    const chip = chipOf(spec);
    assert.equal(chip.shown(), true);
    assert.equal(chip.words(), "Cache 97%");
    assert.equal(chip.frame.el.classList.contains("cold"), true, "dimmed: the figure is the last request's, on the model the chat left");
    assert.match(String(spec.title?.()), /read 97% of its prompt from the provider's cache; the chat has moved to another model since/);
    const card = chip.card();
    assert.ok(card.includes("Prompt cache") && card.includes("97|%") && card.includes("The chat has moved to another model since this request, so its next turn reads none of this cache."), card);
    for (const bit of ["Five-minute", "One-hour", "Warm", "Cold", "Next turn"]) assert.ok(!card.includes(bit), `no "${bit}" in ${card}`);
    // The settings answer is older than the ledger's last request: it says nothing of this one.
    view.settings.cache = { ttl: "5m", from: "rules", settable: false, same: { at: NOW - 900_000, is: false } };
    chip.frame.paint();
    assert.equal(chip.words(), "Cache 97% warm 59 min");
  });
});

describe("a running turn", () => {
  // (fails before: yes — all through a Cursor turn the chip said "Cache 97% warm …", the Claude turn's before it)
  test("on the agent the chat moved to: no chip until a call of its own says its numbers, then that call's", () => {
    const at = NOW - 120_000;
    const view = settingsOf(claudeUsage(at), { ttl: "5m", from: "rules", settable: false, same: { at, is: false } });
    // The chat keeps the last turn's newest call (app.js `meterHears`), heard before the ledger booked that turn.
    const live = agentLive({ streaming: true, usedAt: NOW - 1000, call: { ...callOf({ type: "round-cache", round: 4, input: 100, cacheRead: 30_000, cacheWrite: 900, ttlMs: 3_600_000, ts: at - 2000 }) } });
    const spec = cacheWidget(ctxOf(view, { turns: () => CLAUDE_TURNS, live: () => live }), io);
    const chip = chipOf(spec);
    assert.equal(chip.shown(), false, `the turn's own requests have said nothing yet, where the chip read "${chip.words()}"`);
    // The turn's first call says its numbers (an agent that counts them): the chip is its.
    live.call = callOf({ type: "round-cache", round: 1, input: 8, cacheRead: 0, cacheWrite: 5000, ts: NOW - 500 });
    chip.frame.paint();
    assert.equal(chip.shown(), true);
    assert.equal(chip.words(), "Cache 0%", "a cold start on the new agent, whose cache's life nothing has said");
    live.call = callOf({ type: "round-cache", round: 2, input: 8, cacheRead: 5000, cacheWrite: 300, ttlMs: 300_000, ts: NOW - 200 });
    chip.frame.paint();
    assert.equal(chip.words(), "Cache 94% warm 5 min");
  });

  test("on the agent the chat was on: each call its run says is the last request, with the clock its calls' lifetime gives", () => {
    const at = NOW - 120_000;
    const view = settingsOf(claudeUsage(at), { ttl: "5m", from: "rules", settable: false, same: { at, is: true } });
    const live = agentLive({ streaming: true, usedAt: NOW - 1000, call: null });
    const spec = cacheWidget(ctxOf(view, { turns: () => CLAUDE_TURNS, live: () => live }), io);
    const chip = chipOf(spec);
    assert.equal(chip.words(), "Cache 97% warm 60 min", "until its first call: the last request, in use by this turn");
    live.call = callOf({ type: "round-cache", round: 1, input: 6, cacheRead: 98_000, cacheWrite: 2000, ttlMs: 3_600_000, ts: NOW - 500 });
    chip.frame.paint();
    assert.equal(chip.words(), "Cache 98% warm 60 min");
  });

  test("of a chat that never said any: no chip while it runs, as before it", () => {
    const live = agentLive({ streaming: true, usedAt: NOW - 1000 });
    const chip = chipOf(cacheWidget(ctxOf(settingsOf(CURSOR_USAGE, { ttl: "5m", from: "rules", settable: false, same: { at: NOW - 24_000, is: true } }), { turns: () => CURSOR_TURNS, live: () => live }), io));
    assert.equal(chip.shown(), false);
  });
});

describe("a chat with no request yet where its next one goes", () => {
  const MARKED = { ttl: "5m", from: "rules", settable: true };

  // (fails before: yes — with the chip the newest request's alone, a new chat on a model whose requests Filament's own
  // agent marks for the cache had none, and so nowhere to choose how long its first request's cache is kept)
  test("on a model whose cache Filament's own agent marks: the chip stands with no figure and its card chooses the lifetime; on an agent, no chip until a request says its numbers", () => {
    const spec = cacheWidget(ctxOf(settingsOf(null, MARKED)), io);
    const chip = chipOf(spec);
    assert.equal(chip.shown(), true);
    assert.equal(chip.words(), "Cache —");
    assert.equal(spec.empty?.(), false, "Overview keeps its tile");
    assert.equal(spec.title?.(), "Cache: no request yet");
    const card = chip.card();
    for (const bit of ["Five-minute prompt cache", "Cache lifetime", "5 min", "1 hour", "No request has gone to this model yet. Its first one writes the cache; reads start with the next."]) assert.ok(card.includes(bit), `${bit} in ${card}`);
    assert.doesNotMatch(card, /%|Warm|Cold|Next turn|average|Saved|Last request/, "no figure, no clock, no forecast");
    assert.ok(tileOf(spec).includes("No request yet") && !tileOf(spec).includes("%"), tileOf(spec));
    // An agent's new chat, and one on a provider that caches by itself: nothing says a cache until a request does.
    assert.equal(chipOf(cacheWidget(ctxOf(settingsOf(null, { ...MARKED, settable: false }), { live: () => agentLive() }), io)).shown(), false);
    assert.equal(chipOf(cacheWidget(ctxOf(settingsOf(null, { ...MARKED, settable: false })), io)).shown(), false);
    assert.equal(chipOf(cacheWidget(ctxOf(settingsOf(null, null)), io)).shown(), false);
  });

  test("moved there from an agent that gave no numbers: the chip is back before its first request, with no figure of the agent's", () => {
    const view = settingsOf(CURSOR_USAGE, { ...MARKED, same: { at: CURSOR_USAGE.last.at, is: false } });
    const spec = cacheWidget(ctxOf(view, { turns: () => CURSOR_TURNS }), io);
    const chip = chipOf(spec);
    assert.equal(chip.shown(), true);
    assert.equal(chip.words(), "Cache —");
    assert.equal(spec.title?.(), "Cache: no request yet on the model this chat moved to");
    const card = chip.card();
    assert.ok(card.includes("No request has gone to this model yet.") && card.includes("Cache lifetime"), card);
    assert.doesNotMatch(card, /%|Warm|Cold|Next turn|average|Saved|Last request/);
    // Still on the agent that gives none: no chip, whatever the setting says of a model it is not on.
    assert.equal(chipOf(cacheWidget(ctxOf(settingsOf(CURSOR_USAGE, { ...MARKED, same: { at: CURSOR_USAGE.last.at, is: true } }), { turns: () => CURSOR_TURNS }), io)).shown(), false);
  });
});
