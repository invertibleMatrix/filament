// @ts-check
// What Settings › Usage stats says of a span of days (the owner's of 11-12), as pure functions over the server's
// answer: the tiles and the one sentence that keeps paid, covered by plans and at list price apart, the bars by day and
// by hour, the rows by account, by model, by client and by project, the cache's figures and what it saved, memory's
// own calls, the tools' window — and the words for a range with nothing in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEASURES,
  NOTHING_YET,
  RANGES,
  accountRows,
  accountWords,
  breakdownPath,
  cacheView,
  count,
  csvPath,
  dayBars,
  daySlots,
  dayStart,
  dayWords,
  emptyWords,
  hourBars,
  keptTip,
  keptWords,
  measureFor,
  memoryPath,
  memoryView,
  modelRows,
  money,
  share,
  spanWords,
  speedView,
  tokens,
  tookWords,
  toolsView,
  totalsView,
  weekdayWords,
  whoView,
} from "../src/ui/harness/lib/usage-view.js";
import { WHO_OTHER } from "../src/services/daily-usage.js";
import { NO_PROJECT_ID } from "../src/core/project-id.js";

const SUMS = ["requests", "ok", "errors", "aborted", "input", "cacheRead", "cacheWrite", "output", "thinking", "cost", "costN", "listCost", "listCostN", "planListCost", "tpsSum", "tpsN", "ttftSum", "ttftN", "msSum", "estimated"];
/** A row as the server's `aggregate` gives one: every sum, zero where a test names none. @param {any} o */
const row = (o) => ({ ...Object.fromEntries(SUMS.map((k) => [k, 0])), asked: [], ...o });
/** The span's own sums, as the server adds its rows up. @param {any[]} rows @param {any} [more] */
const totalOf = (rows, more = {}) => {
  const t = Object.fromEntries(SUMS.map((k) => [k, rows.reduce((n, r) => n + r[k], 0)]));
  return { ...t, totalTokens: t.input + t.cacheRead + t.cacheWrite + t.output, hours: new Array(24).fill(0), rows, ...more };
};

const ACCOUNTS = {
  "claude-code-work": { name: "Claude Code · Work", kind: "agent", of: "Claude Code", billing: "plan" },
  codex: { name: "Codex", kind: "agent", of: "Codex", billing: "plan" },
  anthropic: { name: "Anthropic", kind: "provider", of: "Anthropic", billing: "metered" },
};
const ROWS = [
  row({ upstream: "claude-code-work", model: "claude-opus-5", requests: 300, ok: 290, errors: 8, aborted: 2, input: 2_000_000, cacheRead: 40_000_000, cacheWrite: 3_000_000, output: 1_600_000, thinking: 400_000, listCost: 280, listCostN: 300, planListCost: 280, tpsSum: 12_600, tpsN: 280, ttftSum: 420_000, ttftN: 280, msSum: 3_600_000, estimated: 300, asked: [{ name: "claude-code-work/opus", n: 260 }, { name: "opus", n: 40 }] }),
  row({ upstream: "anthropic", model: "claude-opus-5", requests: 52, ok: 50, errors: 2, input: 500_000, cacheRead: 6_000_000, cacheWrite: 500_000, output: 200_000, cost: 11.2, costN: 52, listCost: 11.2, listCostN: 52, tpsSum: 2000, tpsN: 50, ttftSum: 50_000, ttftN: 50, msSum: 416_000, asked: [{ name: "claude-opus-5", n: 52 }] }),
  row({ upstream: "anthropic", model: "claude-haiku-4-5", requests: 20, ok: 20, input: 100_000, output: 40_000, cost: 1.2, costN: 20, listCost: 1.2, listCostN: 20, ttftSum: 6000, ttftN: 20, msSum: 30_000, asked: [{ name: "haiku", n: 20 }] }),
  row({ upstream: "codex", model: "gpt-5.2-codex", requests: 40, ok: 39, aborted: 1, input: 800_000, cacheRead: 3_200_000, output: 300_000, thinking: 100_000, listCost: 30.22, listCostN: 38, planListCost: 30.22, tpsSum: 2340, tpsN: 39, ttftSum: 39_000, ttftN: 39, msSum: 400_000, asked: [{ name: "codex/gpt-5.2-codex", n: 40 }] }),
];
const HOURS = Object.assign(new Array(24).fill(0), { 9: 40, 10: 52, 14: 120, 15: 100, 16: 60, 22: 40 });
const TOTAL = totalOf(ROWS, { hours: HOURS });
/** The server's answer for the last 7 days, seen on Thursday 2026-11-12. */
const B = {
  today: "2026-11-12",
  from: "2026-11-06",
  to: "2026-11-12",
  kept: { days: 45, first: "2026-09-29", last: "2026-11-12", keepDays: 400, file: "C:\\data\\daily-usage.json" },
  days: [
    { day: "2026-11-12", requests: 150, cost: 4.4, listCost: 120.62, planListCost: 116.22, totalTokens: 20_240_000 },
    { day: "2026-11-10", requests: 200, cost: 8, listCost: 160, planListCost: 152, totalTokens: 30_000_000 },
    { day: "2026-11-07", requests: 62, cost: 0, listCost: 42, planListCost: 42, totalTokens: 8_000_000 },
  ],
  total: TOTAL,
  accounts: ACCOUNTS,
  cache: { usd: 250.5, plan: 240.25, models: 2, unpriced: ["gpt-5.2-codex"], flat: [] },
  who: {
    since: "2026-11-10",
    days: 2,
    requests: 350,
    clients: [
      { name: "Filament harness", requests: 300, totalTokens: 50_000_000, cost: 6, costN: 40, listCost: 250, listCostN: 300, planListCost: 244 },
      { name: "OpenCode", requests: 40, totalTokens: 6_000_000, cost: 5, costN: 40, listCost: 5, listCostN: 40, planListCost: 0 },
      { name: WHO_OTHER, requests: 4, totalTokens: 200_000, cost: 0, costN: 0, listCost: 0, listCostN: 0, planListCost: 0 },
    ],
    projects: [
      { id: "p1", name: "shop-api", cwd: "H:\\shop-api", requests: 280, totalTokens: 48_000_000, cost: 6, costN: 30, listCost: 240, listCostN: 280, planListCost: 234 },
      { id: NO_PROJECT_ID, name: null, cwd: null, requests: 60, totalTokens: 8_000_000, cost: 5, costN: 50, listCost: 15, listCostN: 60, planListCost: 10 },
      { id: "9f3a", name: null, cwd: null, requests: 4, totalTokens: 200_000, cost: 0, costN: 0, listCost: 0, listCostN: 0, planListCost: 0 },
    ],
  },
  memoryPurposes: { learn: "Learning", title: "Chat name" },
};

// (fails before: yes — there was no such module: the page summed the days itself and named a range by its days alone)
test("a range's reads: the last days by their number, all time by none, and the same span for the CSV and memory's own", () => {
  assert.deepEqual(RANGES.map((r) => [r.id, r.label, r.days]), [["today", "Today", 1], ["7d", "Last 7 days", 7], ["30d", "Last 30 days", 30], ["all", "All time", 0]]);
  assert.equal(breakdownPath("today"), "/usage/breakdown?days=1");
  assert.equal(breakdownPath("30d"), "/usage/breakdown?days=30");
  assert.equal(breakdownPath("all"), "/usage/breakdown");
  assert.equal(csvPath(B), "/usage/days.csv?from=2026-11-06&to=2026-11-12");
  assert.equal(csvPath({ from: null, to: null }), "/usage/days.csv");
  assert.equal(memoryPath(B), "/memory/usage?from=2026-11-06&to=2026-11-12");
  assert.equal(memoryPath({ from: null, to: null }), "/memory/usage");
});

test("a figure in the room it has: counts, tokens up to billions, dollars to the cent from a dime up, a share, a time", () => {
  assert.deepEqual([count(0), count(412), count(15046)], ["0", "412", "15,046"]);
  assert.deepEqual([840, 4100, 1_200_000, 58_240_000, 999_600_000, 1_240_000_000, 12_000_000_000].map(tokens), ["840", "4.1k", "1.2M", "58M", "1B", "1.2B", "12B"]);
  assert.deepEqual([null, 0, 12.4, 1322.62, 0.08, 0.0035, 0.00001, -0.5].map(money), ["–", "$0.00", "$12.40", "$1,322.62", "$0.08", "$0.0035", "<$0.0001", "−$0.50"]);
  assert.deepEqual([share(0, 0), share(1, 1000), share(37, 100), share(0, 9)], ["–", "<1%", "37%", "0%"]);
  assert.deepEqual([null, 840, 8400, 125_000].map(tookWords), ["–", "840 ms", "8.4 s", "2 min 5 s"]);
});

test("a day in words, with its year only where it is not this one", () => {
  assert.equal(dayWords("2026-11-03", "2026-11-12"), "Nov 3");
  assert.equal(dayWords("2026-11-03", "2027-01-02"), "Nov 3, 2026");
  assert.equal(dayWords("2026-01-31"), "Jan 31");
  assert.equal(weekdayWords("2026-11-12", "2026-11-12"), "Thu, Nov 12");
  assert.equal(weekdayWords("2025-12-31", "2026-11-12"), "Wed, Dec 31, 2025");
  assert.equal(dayStart("2026-11-12"), new Date(2026, 10, 12).getTime(), "a day begins at this computer's midnight");
  // The days an answer covers, as a section's source line says them.
  assert.equal(spanWords(B), "Nov 6 to Nov 12");
  assert.equal(spanWords({ ...B, from: "2026-11-12" }), "today");
  assert.equal(spanWords({ ...B, from: "2026-11-03", to: "2026-11-03" }), "Nov 3");
  assert.equal(spanWords({ ...B, from: null, to: null }), "since Sep 29");
  assert.equal(spanWords({ ...B, from: null, to: null, kept: { days: 0, first: null } }), "all time");
});

test("what is on record is said beside All time; a range with nothing says which nothing", () => {
  assert.equal(keptWords(B.kept, B.today), "45 days on record, from Sep 29");
  assert.equal(keptWords({ days: 1, first: "2025-12-31" }, B.today), "1 day on record, from Dec 31, 2025");
  assert.equal(keptWords({ days: 0, first: null }, B.today), "");
  assert.equal(emptyWords(B), null);
  assert.equal(NOTHING_YET, "Nothing yet: usage is counted from the first model call through Filament.");
  assert.equal(emptyWords({ ...B, kept: { days: 0, first: null, last: null }, total: totalOf([]) }), NOTHING_YET);
  const quiet = { ...B, kept: { ...B.kept, last: "2026-11-10" }, total: totalOf([]) };
  assert.equal(emptyWords(quiet), "No calls in this range. The newest day on record is Nov 10.");
  assert.equal(emptyWords({ ...quiet, from: "2026-11-12" }), "No calls today. The newest day on record is Nov 10.");
});

// (fails before: yes — the answer named the file and how many days it keeps, and nothing on the page said where it is)
test("the line that says what is on record names the file and how many days it keeps, as its tip", () => {
  assert.equal(keptTip(B.kept), "Kept in C:\\data\\daily-usage.json: the newest 400 days that had a call.");
  assert.equal(keptTip({ days: 3, keepDays: 400, file: null }), "", "a store that writes no file names none");
  assert.equal(keptTip({ days: 0, keepDays: 400, file: "C:\\data\\daily-usage.json" }), "", "nothing on record, nothing to point at");
  assert.equal(keptTip(null), "");
});

// (fails before: yes — six tiles with no line: "Paid" beside "At list price", and nothing said which was which)
test("the totals: two rows of tiles, and one sentence that says paid, covered by plans and at list price apart", () => {
  const t = totalsView(TOTAL, ACCOUNTS);
  assert.deepEqual(t.work, [
    { key: "calls", label: "Calls", value: "412", line: "10 failed · 3 stopped" },
    { key: "tokens", label: "Tokens through Filament", value: "58M", line: "in 56M · out 2.1M" },
    { key: "cache", label: "Cache hit rate", value: "88%", line: "49M read from cache" },
  ]);
  assert.deepEqual(t.money, [
    { key: "paid", label: "Paid", value: "$12.40", line: "340 calls on plans paid nothing here" },
    { key: "plans", label: "Covered by plans", value: "$310.22", line: "what those calls are worth at list price" },
    { key: "list", label: "At list price", value: "$322.62", line: "of 410 calls: the rest named no price" },
  ]);
  assert.equal(t.sentence, "You paid $12.40. Your plans covered calls worth $310.22 at list price. All of it at list price: $322.62.");
  // A plan alone: nothing paid, and no third figure that would only repeat the second.
  const plan = totalsView(totalOf([ROWS[0]]), ACCOUNTS);
  assert.equal(plan.sentence, "Your plans covered calls worth $280.00 at list price.");
  assert.deepEqual(plan.money.map((x) => [x.value, x.line]), [["$0.00", "300 calls on plans paid nothing here"], ["$280.00", "what those calls are worth at list price"], ["$280.00", "plans and keys together"]]);
  // Keys alone.
  const keys = totalsView(totalOf([ROWS[1], ROWS[2]]), ACCOUNTS);
  assert.equal(keys.sentence, "You paid $12.40.");
  assert.deepEqual(keys.money.map((x) => [x.value, x.line]), [["$12.40", "every call was pay as you go"], ["$0.00", "no call was on a plan"], ["$12.40", "plans and keys together"]]);
  // A provider's own charge beside its card's price: both are said.
  assert.equal(totalsView(totalOf([row({ upstream: "anthropic", model: "m", requests: 2, cost: 3, costN: 2, listCost: 4, listCostN: 2 })]), ACCOUNTS).sentence, "You paid $3.00. At list price it comes to $4.00.");
  // No call named a price: a dash, never $0, and the calls on a key that had none are counted.
  const bare = totalsView(totalOf([row({ upstream: "anthropic", model: "nobody-1", requests: 3 })]), ACCOUNTS);
  assert.deepEqual(bare.money.map((x) => [x.value, x.line]), [["–", "every call was pay as you go"], ["$0.00", "no call was on a plan"], ["–", "no call named a list price"]]);
  assert.equal(bare.sentence, "No call here named a price.");
  assert.equal(totalsView(totalOf([ROWS[1], row({ upstream: "anthropic", model: "nobody-1", requests: 3 })]), ACCOUNTS).sentence, "You paid $11.20. 3 calls named no price and are in none of these figures.");
  // A plan whose calls named no list price: what it covered is not known, and is not $0.
  const mute = totalsView(totalOf([row({ upstream: "codex", model: "gpt-5.2", requests: 5 })]), ACCOUNTS);
  assert.deepEqual(mute.money[1], { key: "plans", label: "Covered by plans", value: "–", line: "its 5 calls named no list price" });
  assert.equal(totalsView(totalOf([]), {}).sentence, "");
});

// (fails before: yes — one bar a day of cost alone, each a colour of its own, a day with no call left out of the row)
test("over time: a slot for every day of the range, bars by the chosen measure, list price stacked in two", () => {
  assert.deepEqual(MEASURES.map((m) => [m.id, m.label]), [["cost", "Paid"], ["list", "At list price"], ["tokens", "Tokens"], ["calls", "Calls"]]);
  assert.deepEqual([measureFor(TOTAL), measureFor(totalOf([ROWS[0]])), measureFor(totalOf([row({ requests: 1, input: 5 })]))], ["cost", "list", "tokens"]);
  const slots = daySlots(B);
  assert.deepEqual(slots.map((d) => [d.day, d.requests]), [["2026-11-06", 0], ["2026-11-07", 62], ["2026-11-08", 0], ["2026-11-09", 0], ["2026-11-10", 200], ["2026-11-11", 0], ["2026-11-12", 150]]);
  // All time runs from the first day on record to today; a month's end is crossed by the calendar.
  assert.equal(daySlots({ ...B, from: null, to: null }).length, 45);
  assert.deepEqual(daySlots({ ...B, from: "2026-02-27", to: "2026-03-01", days: [] }).map((d) => d.day), ["2026-02-27", "2026-02-28", "2026-03-01"]);
  assert.deepEqual(daySlots({ ...B, from: null, to: null, kept: { days: 0, first: null, last: null } }), []);

  const paid = dayBars(slots, "cost", B.today);
  assert.equal(paid.max, 8);
  assert.equal(paid.legend, null);
  assert.deepEqual(paid.bars.map((b) => [b.parts.map((p) => [p.key, p.pct]), b.tip]), [
    [[], "Fri, Nov 6: no calls"],
    [[], "Sat, Nov 7: nothing paid, 62 calls"],
    [[], "Sun, Nov 8: no calls"],
    [[], "Mon, Nov 9: no calls"],
    [[["keys", 100]], "Tue, Nov 10: $8.00 paid"],
    [[], "Wed, Nov 11: no calls"],
    [[["keys", 55]], "Thu, Nov 12: $4.40 paid"],
  ]);
  assert.equal(paid.label, "Paid by day, Nov 6 to Nov 12: $12.40 in all, the most $8.00 on Nov 10.");
  assert.equal(paid.peak, "Most in a day: $8.00, Tue, Nov 10");
  assert.deepEqual([paid.first, paid.last], ["Nov 6", "Nov 12"]);

  const list = dayBars(slots, "list", B.today);
  assert.deepEqual(list.legend, [{ key: "keys", label: "Paid on metered keys" }, { key: "plans", label: "Covered by plans" }]);
  assert.deepEqual(list.bars.filter((b) => b.parts.length).map((b) => [b.parts.map((p) => [p.key, p.pct]), b.tip]), [
    [[["plans", 26.3]], "Sat, Nov 7: $42.00 at list price, all of it covered by plans"],
    [[["keys", 5], ["plans", 95]], "Tue, Nov 10: $160.00 at list price ($8.00 on metered keys, $152.00 covered by plans)"],
    [[["keys", 2.8], ["plans", 72.6]], "Thu, Nov 12: $120.62 at list price ($4.40 on metered keys, $116.22 covered by plans)"],
  ]);
  assert.equal(list.label, "At list price by day, Nov 6 to Nov 12: $322.62 in all, the most $160.00 on Nov 10.");

  const toks = dayBars(slots, "tokens", B.today);
  assert.deepEqual([toks.bars[4].tip, toks.bars[4].parts, toks.peak], ["Tue, Nov 10: 30M tokens", [{ key: "all", value: 30_000_000, pct: 100 }], "Most in a day: 30M tokens, Tue, Nov 10"]);
  const calls = dayBars(slots, "calls", B.today);
  assert.deepEqual([calls.bars[6].tip, calls.bars[6].parts[0].pct, calls.label], ["Thu, Nov 12: 150 calls", 75, "Calls by day, Nov 6 to Nov 12: 412 calls in all, the most 200 calls on Nov 10."]);
  // Nothing to draw: no bar, and the label says so.
  const none = dayBars(daySlots({ ...B, days: [] }), "cost", B.today);
  assert.deepEqual([none.max, none.bars.every((b) => !b.parts.length), none.label, none.peak], [0, true, "Paid by day, Nov 6 to Nov 12: nothing.", ""]);
});

// (fails before: yes — the page named no account at all)
test("by account: each as a person knows it, with what it is, its share of the range's tokens and its models under it", () => {
  assert.deepEqual(accountWords("claude-code-work", ACCOUNTS), { name: "Claude Code · Work", what: "plan · Claude Code" });
  assert.deepEqual(accountWords("codex", ACCOUNTS), { name: "Codex", what: "plan · coding agent" });
  assert.deepEqual(accountWords("anthropic", ACCOUNTS), { name: "Anthropic", what: "pay as you go · provider" });
  assert.deepEqual(accountWords("k", { k: { name: "Work key", kind: "provider", of: "Anthropic", billing: "metered" } }), { name: "Work key", what: "pay as you go · Anthropic" });
  assert.deepEqual(accountWords("box", { box: { name: "Studio PC", kind: "machine", of: null, billing: "metered" } }), { name: "Studio PC", what: "another computer's Filament" });
  assert.deepEqual(accountWords("left", { left: { name: "left", kind: "gone", of: null, billing: null } }), { name: "left", what: "no longer set up" });
  assert.deepEqual(accountWords("?", {}), { name: "Unknown", what: "calls that named no account" });
  assert.deepEqual(accountWords("__proto__", {}), { name: "__proto__", what: "no longer set up" }, "a name is a name, never the object's own part");

  const rows = accountRows(TOTAL, ACCOUNTS);
  assert.deepEqual(rows.map((r) => [r.name, r.what, r.shareWords, r.cells]), [
    ["Claude Code · Work", "plan · Claude Code", "80% of this range's tokens", { calls: "300", tokens: "47M", input: "45M", output: "1.6M", cacheHit: "89%", paid: "$0.00", list: "$280.00", plan: "plan" }],
    ["Anthropic", "pay as you go · provider", "13% of this range's tokens", { calls: "72", tokens: "7.3M", input: "7.1M", output: "240k", cacheHit: "85%", paid: "$12.40", list: "$12.40", plan: "" }],
    ["Codex", "plan · coding agent", "7% of this range's tokens", { calls: "40", tokens: "4.3M", input: "4M", output: "300k", cacheHit: "80%", paid: "$0.00", list: "$30.22", plan: "plan" }],
  ]);
  assert.ok(Math.abs(rows[0].share - 46_600_000 / 58_240_000) < 1e-9);
  assert.deepEqual(rows[1].models.map((m) => [m.model, m.cells.calls, m.cells.tokens, m.cells.paid]), [["claude-opus-5", "52", "7.2M", "$11.20"], ["claude-haiku-4-5", "20", "140k", "$1.20"]]);
  // A plan's calls that named no charge paid nothing by the token: $0, above. Where no call named a list price either
  // — a plan's or a key's — nothing is known, and the cells say a dash.
  assert.deepEqual(accountRows(totalOf([row({ upstream: "anthropic", model: "nobody-1", requests: 3 }), row({ upstream: "codex", model: "gpt-5.2", requests: 5 })]), ACCOUNTS).map((r) => [r.name, r.cells.paid, r.cells.list, r.cells.plan]), [["Codex", "–", "–", ""], ["Anthropic", "–", "–", ""]]);
  assert.deepEqual(accountRows(totalOf([]), {}), []);
});

// (fails before: yes — the page named no model at all)
test("by model: one row for a model whatever accounts ran it, and the rest behind its disclosure", () => {
  const rows = modelRows(TOTAL, ACCOUNTS);
  assert.deepEqual(rows.map((r) => [r.model, r.cells]), [
    ["claude-opus-5", { calls: "352", tokens: "54M", input: "52M", output: "1.8M", cacheHit: "88%", paid: "$11.20", list: "$291.20", plan: "$280.00 plan" }],
    ["gpt-5.2-codex", { calls: "40", tokens: "4.3M", input: "4M", output: "300k", cacheHit: "80%", paid: "$0.00", list: "$30.22", plan: "plan" }],
    ["claude-haiku-4-5", { calls: "20", tokens: "140k", input: "100k", output: "40k", cacheHit: "0%", paid: "$1.20", list: "$1.20", plan: "" }],
  ]);
  assert.deepEqual(rows[0].details, [
    { label: "Input", value: "2.5M new · 46M read from cache · 3.5M written to cache" },
    { label: "Thinking", value: "400k tokens" },
    { label: "Average speed", value: "44.2 tok/s" },
    { label: "Average to first token", value: "1.4 s" },
    { label: "Average call", value: "11.4 s" },
    { label: "Failed, stopped", value: "10 failed · 2 stopped" },
    { label: "Estimated tokens", value: "300 calls counted by estimate, not by the provider's own count" },
    { label: "Asked for as", value: "claude-code-work/opus ×260, claude-opus-5 ×52, opus ×40" },
    { label: "Ran on", value: "Claude Code · Work ×300, Anthropic ×52" },
  ]);
  const haiku = Object.fromEntries(rows[2].details.map((d) => [d.label, d.value]));
  assert.deepEqual([haiku["Average speed"], haiku["Average to first token"], haiku["Average call"], haiku["Estimated tokens"], haiku["Ran on"]], ["–", "300 ms", "1.5 s", "none: every call's tokens are its provider's own count", "Anthropic ×20"]);
  // Names asked for past the first six are counted, not listed.
  const many = modelRows(totalOf([row({ upstream: "anthropic", model: "m", requests: 8, asked: Array.from({ length: 8 }, (_, i) => ({ name: `n${i}`, n: 8 - i })) })]), ACCOUNTS);
  assert.equal(many[0].details.find((d) => d.label === "Asked for as")?.value, "n0 ×8, n1 ×7, n2 ×6, n3 ×5, n4 ×4, n5 ×3, and 2 more");
});

// (fails before: yes — nothing said of the cache but what a day's row held)
test("the cache: read, written, not cached, the hit rate, and what it saved said as the estimate it is", () => {
  const c = cacheView(TOTAL, B.cache);
  assert.deepEqual(c.figures, [
    { key: "read", label: "Read from cache", value: "49M", line: "input the provider already had" },
    { key: "written", label: "Written to cache", value: "3.5M", line: "input kept for the calls after" },
    { key: "new", label: "Not cached", value: "3.4M", line: "input sent as new" },
    { key: "rate", label: "Hit rate", value: "88%", line: "read from cache, of all input" },
  ]);
  assert.equal(c.saved, "≈ $250.50 at today's list prices");
  assert.deepEqual(c.lines, [
    "Cache reads priced as new input, less what they cost as cache reads, less what cache writes cost over new input: by each model's price as it stands today, not as it was on the day.",
    "≈ $240.25 of it is on plans: what those calls would have cost less at list price, not money you paid less.",
    "1 model has no list price and is left out: gpt-5.2-codex.",
  ]);
  assert.equal(c.none, false);
  // More written than was read back.
  const more = cacheView(TOTAL, { usd: -0.5, plan: 0, models: 1, unpriced: [], flat: [] });
  assert.equal(more.saved, "≈ $0.50 more, at today's list prices");
  assert.equal(more.lines[0], "Writing to the cache cost more here than reading from it saved: cache writes are priced over new input, cache reads under it, by each model's price as it stands today.");
  // Nothing priced apart: the tokens alone, and why.
  const flat = cacheView(TOTAL, { usd: null, plan: 0, models: 0, unpriced: ["a", "b", "c", "d", "e", "f"], flat: ["plain-1"] });
  assert.equal(flat.saved, "–");
  assert.deepEqual(flat.lines, [
    "6 models have no list price and are left out: a, b, c, d and 2 more.",
    "1 model costs the same read from cache or not on its card, so there is no saving to say: plain-1.",
  ]);
  const none = cacheView(totalOf([ROWS[2]]), { usd: null, plan: 0, models: 0, unpriced: [], flat: [] });
  assert.deepEqual([none.none, none.saved, none.lines], [true, "–", ["No call in this range read from a cache or wrote to one."]]);
});

// (fails before: yes)
test("speed and reliability: the averages over the calls that reported them, failed and stopped as counts and shares", () => {
  const s = speedView(TOTAL, ACCOUNTS);
  assert.deepEqual(s.all, { name: "All accounts", cells: { speed: "45.9 tok/s", first: "1.3 s", call: "10.8 s", failed: "10 (2%)", stopped: "3 (<1%)" } });
  assert.deepEqual(s.accounts, [
    { name: "Claude Code · Work", cells: { speed: "45 tok/s", first: "1.5 s", call: "12.0 s", failed: "8 (3%)", stopped: "2 (<1%)" } },
    { name: "Anthropic", cells: { speed: "40 tok/s", first: "800 ms", call: "6.2 s", failed: "2 (3%)", stopped: "0" } },
    { name: "Codex", cells: { speed: "60 tok/s", first: "1.0 s", call: "10.0 s", failed: "0", stopped: "1 (3%)" } },
  ]);
});

// (fails before: yes)
test("when: 24 bars by the hour of the day, the busiest said", () => {
  const h = hourBars(HOURS);
  assert.equal(h.bars.length, 24);
  assert.deepEqual([h.max, h.bars[14].pct, h.bars[9].pct, h.bars[0].pct], [120, 100, 33.3, 0]);
  assert.deepEqual([h.bars[14].tip, h.bars[0].tip, h.bars[23].tip], ["14:00 to 15:00: 120 calls", "00:00 to 01:00: no calls", "23:00 to 00:00: no calls"]);
  assert.equal(h.busiest, "Busiest: 14:00 to 15:00, 120 calls.");
  assert.equal(h.label, "Calls by hour of day: 412 calls, the most 120 calls from 14:00 to 15:00.");
  const none = hourBars([]);
  assert.deepEqual([none.bars.length, none.max, none.busiest, none.label], [24, 0, "", "Calls by hour of day: none."]);
});

// (fails before: yes — who asked was read over the newest few hundred requests alone, and no day kept it)
test("who asked: by client and by project, the rest and no project in words, and what was not kept said with its day", () => {
  const w = whoView(B);
  assert.deepEqual(w.clients.map((c) => [c.name, c.title, c.cells]), [
    ["Filament harness", "", { calls: "300", tokens: "50M", paid: "$6.00", list: "$250.00", plan: "$244.00 plan" }],
    ["OpenCode", "", { calls: "40", tokens: "6M", paid: "$5.00", list: "$5.00", plan: "" }],
    ["Other clients", "The clients a day keeps no name for, as one", { calls: "4", tokens: "200k", paid: "–", list: "–", plan: "" }],
  ]);
  assert.ok(Math.abs(w.clients[0].share - 50 / 56.2) < 1e-9);
  assert.deepEqual(w.projects.map((p) => [p.name, p.title, p.cells.calls]), [
    ["shop-api", "H:\\shop-api · project p1", "280"],
    ["No project", "Calls booked on no project: another tool's, or a chat that named no folder", "60"],
    ["9f3a", "project 9f3a", "4"],
  ]);
  assert.equal(w.note, "68 of this range's 412 calls are in neither list: who asked is not kept before Nov 10.");
  assert.equal(w.none, false);
  // Every call counted: nothing to add.
  assert.equal(whoView({ ...B, total: { ...TOTAL, requests: 344 } }).note, "");
  // No day carries it yet.
  const before = whoView({ ...B, who: { since: null, days: 0, requests: 0, clients: [], projects: [] } });
  assert.deepEqual([before.none, before.note], [true, "Who asked is kept by the day from this version on: none of this range's 412 calls has it."]);
  assert.deepEqual(whoView({ ...B, total: totalOf([]), who: { since: null, days: 0, requests: 0, clients: [], projects: [] } }).note, "");
  assert.equal(whoView({ ...B, who: { ...B.who, projects: [{ id: WHO_OTHER, name: null, cwd: null, requests: 1, totalTokens: 5, costN: 0, listCostN: 0 }] } }).projects[0].name, "Other projects");
});

// (fails before: yes — memory's own calls were on no page of the harness)
test("memory's own calls, by what each was for", () => {
  const rows = [
    row({ purpose: "learn", upstream: "anthropic", model: "claude-haiku-4-5", requests: 30, input: 60_000, output: 9000, cost: 0.12, costN: 30, listCost: 0.12, listCostN: 30 }),
    row({ purpose: "title", upstream: "anthropic", model: "claude-haiku-4-5", requests: 12, input: 6000, output: 600, cost: 0.009, costN: 12, listCost: 0.009, listCostN: 12 }),
    row({ purpose: "learn", upstream: "x", model: "y", requests: 2, input: 1000, output: 100 }),
    row({ purpose: "newer", upstream: "x", model: "y", requests: 1, input: 10, output: 1 }),
  ];
  const m = memoryView(totalOf(rows), B.memoryPurposes);
  assert.deepEqual(m.rows.map((r) => [r.label, r.cells.calls, r.cells.tokens, r.cells.paid, r.cells.list]), [
    ["Learning", "32", "70k", "$0.12", "$0.12"],
    ["Chat name", "12", "6.6k", "$0.009", "$0.009"],
    ["newer", "1", "11", "–", "–"],
  ]);
  assert.equal(m.line, "45 calls · 77k tokens · $0.13 paid · $0.13 at list price");
  assert.equal(m.none, false);
  assert.deepEqual(memoryView(totalOf([]), {}), { rows: [], line: "", none: true });
});

test("the tools' window is said on their label", () => {
  const counts = new Map([["bash", 80], ["read", 120], ["edit", 40]]);
  const t = toolsView(counts, { runs: 180, read: 50 });
  assert.equal(t.label, "from the newest 50 runs");
  assert.equal(t.total, "240 tool calls");
  assert.deepEqual(t.rows, [{ name: "read", n: "120", pct: 100 }, { name: "bash", n: "80", pct: 66.7 }, { name: "edit", n: "40", pct: 33.3 }]);
  assert.equal(toolsView(counts, { runs: 12, read: 12 }).label, "from this range's 12 runs");
  assert.equal(toolsView(new Map([["read", 1]]), { runs: 1, read: 1 }).label, "from this range's 1 run");
  assert.deepEqual(toolsView(new Map(), { runs: 0, read: 0 }), { label: "from this range's 0 runs", total: "0 tool calls", rows: [], none: true });
});
