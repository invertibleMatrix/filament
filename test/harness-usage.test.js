// @ts-check
// Settings › Usage stats (the owner's of 11-12): the whole breakdown of a chosen range on one page — the totals with
// paid, covered by plans and at list price said apart, the bars by day for a chosen measure, by account, by model,
// the cache, speed and reliability, the hours, who asked, memory's own calls, the tools — each section saying where
// its numbers come from. Built on the stub document over a scripted admin API.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { renderUsage } from "../src/ui/harness/settings/usage.js";
import { DESCRIPTIONS, SECTIONS } from "../src/ui/harness/settings/page.js";
import { SEARCH_ROWS as DATA_ROWS } from "../src/ui/harness/settings/data-privacy.js";
import { NOTHING_YET } from "../src/ui/harness/lib/usage-view.js";

const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};
const g = /** @type {any} */ (globalThis);
/** @type {ReturnType<typeof stubDocument>} */
let doc;
let hadFrame = false;
beforeEach(() => {
  doc = stubDocument();
  hadFrame = "requestAnimationFrame" in g;
  if (!hadFrame) g.requestAnimationFrame = (/** @type {() => void} */ fn) => (fn(), 0);
});
afterEach(() => {
  if (!hadFrame) delete g.requestAnimationFrame;
  doc.restore();
});

const SUMS = ["requests", "ok", "errors", "aborted", "input", "cacheRead", "cacheWrite", "output", "thinking", "cost", "costN", "listCost", "listCostN", "planListCost", "tpsSum", "tpsN", "ttftSum", "ttftN", "msSum", "estimated"];
/** @param {any} o */
const row = (o) => ({ ...Object.fromEntries(SUMS.map((k) => [k, 0])), asked: [], ...o });
/** @param {any[]} rows @param {any} [more] */
const totalOf = (rows, more = {}) => {
  const t = Object.fromEntries(SUMS.map((k) => [k, rows.reduce((n, r) => n + r[k], 0)]));
  return { ...t, totalTokens: t.input + t.cacheRead + t.cacheWrite + t.output, hours: new Array(24).fill(0), rows, ...more };
};
const ROWS = [
  row({ upstream: "claude-code-work", model: "claude-opus-5", requests: 300, ok: 290, errors: 8, aborted: 2, input: 2_000_000, cacheRead: 40_000_000, cacheWrite: 3_000_000, output: 1_600_000, thinking: 400_000, listCost: 280, listCostN: 300, planListCost: 280, tpsSum: 12_600, tpsN: 280, ttftSum: 420_000, ttftN: 280, msSum: 3_600_000, estimated: 300, asked: [{ name: "claude-code-work/opus", n: 260 }, { name: "opus", n: 40 }] }),
  row({ upstream: "anthropic", model: "claude-opus-5", requests: 52, ok: 50, errors: 2, input: 500_000, cacheRead: 6_000_000, cacheWrite: 500_000, output: 200_000, cost: 11.2, costN: 52, listCost: 11.2, listCostN: 52, tpsSum: 2000, tpsN: 50, ttftSum: 50_000, ttftN: 50, msSum: 416_000, asked: [{ name: "claude-opus-5", n: 52 }] }),
  row({ upstream: "anthropic", model: "claude-haiku-4-5", requests: 20, ok: 20, input: 100_000, output: 40_000, cost: 1.2, costN: 20, listCost: 1.2, listCostN: 20, ttftSum: 6000, ttftN: 20, msSum: 30_000, asked: [{ name: "haiku", n: 20 }] }),
  row({ upstream: "codex", model: "gpt-5.2-codex", requests: 40, ok: 39, aborted: 1, input: 800_000, cacheRead: 3_200_000, output: 300_000, thinking: 100_000, listCost: 30.22, listCostN: 38, planListCost: 30.22, tpsSum: 2340, tpsN: 39, ttftSum: 39_000, ttftN: 39, msSum: 400_000, asked: [{ name: "codex/gpt-5.2-codex", n: 40 }] }),
];
const HOURS = Object.assign(new Array(24).fill(0), { 9: 40, 10: 52, 14: 120, 15: 100, 16: 60, 22: 40 });
/** The last 7 days, as the server answers them on Thursday 2026-11-12. */
const WEEK = {
  today: "2026-11-12",
  from: "2026-11-06",
  to: "2026-11-12",
  kept: { days: 45, first: "2026-09-29", last: "2026-11-12", keepDays: 400, file: "C:\\data\\daily-usage.json" },
  days: [
    { day: "2026-11-12", requests: 150, cost: 4.4, listCost: 120.62, planListCost: 116.22, totalTokens: 20_240_000 },
    { day: "2026-11-10", requests: 200, cost: 8, listCost: 160, planListCost: 152, totalTokens: 30_000_000 },
    { day: "2026-11-07", requests: 62, cost: 0, listCost: 42, planListCost: 42, totalTokens: 8_000_000 },
  ],
  total: totalOf(ROWS, { hours: HOURS }),
  accounts: {
    "claude-code-work": { name: "Claude Code · Work", kind: "agent", of: "Claude Code", billing: "plan" },
    codex: { name: "Codex", kind: "agent", of: "Codex", billing: "plan" },
    anthropic: { name: "Anthropic", kind: "provider", of: "Anthropic", billing: "metered" },
  },
  cache: { usd: 250.5, plan: 240.25, models: 2, unpriced: ["gpt-5.2-codex"], flat: [] },
  who: {
    since: "2026-11-10",
    days: 2,
    requests: 350,
    clients: [
      { name: "Filament harness", requests: 300, totalTokens: 50_000_000, cost: 6, costN: 40, listCost: 250, listCostN: 300, planListCost: 244 },
      { name: "OpenCode", requests: 44, totalTokens: 6_000_000, cost: 5, costN: 44, listCost: 5, listCostN: 44, planListCost: 0 },
    ],
    projects: [
      { id: "p1", name: "shop-api", cwd: "H:\\shop-api", requests: 280, totalTokens: 48_000_000, cost: 6, costN: 30, listCost: 240, listCostN: 280, planListCost: 234 },
      { id: "none", name: null, cwd: null, requests: 64, totalTokens: 8_000_000, cost: 5, costN: 54, listCost: 15, listCostN: 64, planListCost: 10 },
    ],
  },
  memoryPurposes: { learn: "Learning", title: "Chat name" },
};
/** Today alone: one account, one model. */
const TODAY = {
  ...WEEK,
  from: "2026-11-12",
  days: [WEEK.days[0]],
  total: totalOf([ROWS[2]], { hours: Object.assign(new Array(24).fill(0), { 9: 20 }) }),
  cache: { usd: null, plan: 0, models: 0, unpriced: [], flat: [] },
  who: { since: "2026-11-10", days: 1, requests: 20, clients: [{ name: "OpenCode", requests: 20, totalTokens: 140_000, cost: 1.2, costN: 20, listCost: 1.2, listCostN: 20, planListCost: 0 }], projects: [] },
};
const MEMORY = {
  today: "2026-11-12",
  total: totalOf([
    row({ purpose: "learn", upstream: "anthropic", model: "claude-haiku-4-5", requests: 30, input: 60_000, output: 9000, cost: 0.12, costN: 30, listCost: 0.12, listCostN: 30 }),
    row({ purpose: "title", upstream: "anthropic", model: "claude-haiku-4-5", requests: 12, input: 6000, output: 600, cost: 0.009, costN: 12, listCost: 0.009, listCostN: 12 }),
  ]),
};

/** A promise and its ends, to hold a read back. */
const held = () => {
  /** @type {(v?: unknown) => void} */
  let open = () => {};
  const wait = new Promise((r) => { open = r; });
  return { wait, open };
};

/**
 * The admin API, scripted: the breakdown by its range, memory's own calls, the runs and their events. `hold`: a path
 * whose answer waits until the test lets it go; `fail`: a path's refusal, in the server's words.
 * @param {{ week?: any, today?: any, memory?: any, runs?: any[], hold?: Record<string, { wait: Promise<unknown> }>, fail?: Record<string, string> }} [o]
 */
function server(o = {}) {
  /** @type {string[]} */
  const calls = [];
  const runs = o.runs || [
    { id: "r1", startedAt: Date.parse("2026-11-12T10:00:00") },
    { id: "r2", startedAt: Date.parse("2026-11-10T09:00:00") },
    { id: "old", startedAt: Date.parse("2026-10-01T09:00:00") },
  ];
  /** @param {string} path */
  const api = async (path) => {
    calls.push(path);
    if (o.hold?.[path]) await o.hold[path].wait;
    if (o.fail?.[path]) throw new Error(o.fail[path]);
    if (path === "/usage/breakdown?days=7") return o.week || WEEK;
    if (path === "/usage/breakdown?days=1") return o.today || TODAY;
    if (path.startsWith("/memory/usage")) return o.memory || MEMORY;
    if (path === "/runs?limit=200") return { runs };
    if (path === "/runs/r1/events?since=0&limit=5000") return { events: [{ type: "tool-start", name: "Read" }, { type: "tool-start", name: "bash" }, { type: "tool-end" }, { type: "tool-start", name: "read" }] };
    if (path === "/runs/r2/events?since=0&limit=5000") return { events: [{ type: "tool-start", name: "edit" }] };
    throw new Error(`unscripted ${path}`);
  };
  return { api, calls };
}

/** A settings body on the page, as the settings' frame hands one to a section. @returns {any} */
const page = () => {
  const body = doc.document.createElement("div");
  doc.document.body.append(body);
  return body;
};
/** @param {any} el @param {string} sel */
const texts = (el, sel) => el.querySelectorAll(sel).map((/** @type {any} */ x) => x.textContent);
/** A section of the page, by its name. @param {any} body @param {string} name */
const sec = (body, name) => body.querySelector(`[data-sec='${name}']`);
/** A table's rows as their cells' words, the rows put away left out. @param {any} table */
const shown = (table) => table.querySelectorAll("tbody tr").filter((/** @type {any} */ tr) => !tr.hasAttribute("hidden")).map((/** @type {any} */ tr) => tr.children.map((/** @type {any} */ td) => td.textContent));
/** @param {any} el @param {string} label */
const press = (el, label) => {
  const b = el.querySelectorAll("button").find((/** @type {any} */ x) => x.textContent === label);
  assert.ok(b, `a button that says ${label}`);
  b.dispatch("click");
};

// (fails before: yes — the page was six tiles, a bar a day of cost and the tools: no account, no model, no cache, no
// hour, nobody who asked, and "Paid" stood beside "At list price" with no word on which was which)
test("the whole breakdown of the last 7 days, section by section, each saying where its numbers come from", async () => {
  const s = server();
  const body = page();
  renderUsage(body, {}, { api: s.api });
  // The frames stand at once, before a read lands: the range, the export, every section's head.
  assert.deepEqual(texts(body, ".zc-pills[aria-label='Range'] .zc-pill"), ["Today", "Last 7 days", "Last 30 days", "All time"]);
  assert.deepEqual(texts(body, ".uset-h"), ["Totals", "Over time", "By account", "By model", "Cache", "Speed and reliability", "When", "Who asked", "Memory's own calls", "Tools"]);
  assert.equal(body.querySelector(".uset-main").getAttribute("aria-busy"), "true");
  await settle();
  assert.equal(body.querySelector(".uset-main").getAttribute("aria-busy"), "false");
  assert.deepEqual(s.calls.slice(0, 1), ["/usage/breakdown?days=7"], "one read fills the page");
  assert.equal(body.querySelector(".uset-kept").textContent, "45 days on record, from Sep 29");
  assert.equal(body.querySelector(".uset-kept").getAttribute("title"), "Kept in C:\\data\\daily-usage.json: the newest 400 days that had a call.", "where the record is, as the line's tip");

  // Totals.
  const totals = sec(body, "totals");
  assert.equal(totals.querySelector(".uset-src").textContent, "From the daily record, Nov 6 to Nov 12: every model call that finished through this Filament, its memory's own aside.");
  assert.deepEqual(totals.querySelectorAll(".set-tile").map((/** @type {any} */ t) => t.children.map((/** @type {any} */ c) => c.textContent)), [
    ["Calls", "412", "10 failed · 3 stopped"],
    ["Tokens through Filament", "58M", "in 56M · out 2.1M"],
    ["Cache hit rate", "88%", "49M read from cache"],
    ["Paid", "$12.40", "340 calls on plans paid nothing here"],
    ["Covered by plans", "$310.22", "what those calls are worth at list price"],
    ["At list price", "$322.62", "of 410 calls: the rest named no price"],
  ]);
  assert.equal(totals.querySelector(".uset-say").textContent, "You paid $12.40. Your plans covered calls worth $310.22 at list price. All of it at list price: $322.62.");

  // Over time: a bar for each of the 7 days, on the measure the range opens on; a picture with its own sentence.
  const time = sec(body, "time");
  assert.deepEqual(texts(time, ".zc-pills .zc-pill"), ["Paid", "At list price", "Tokens", "Calls"]);
  assert.equal(time.querySelector(".zc-pill.on").textContent, "Paid");
  const chart = time.querySelector(".uset-chart");
  assert.equal(chart.getAttribute("role"), "img");
  assert.equal(chart.getAttribute("aria-label"), "Paid by day, Nov 6 to Nov 12: $12.40 in all, the most $8.00 on Nov 10.");
  assert.deepEqual(chart.querySelectorAll(".uset-bar").map((/** @type {any} */ b) => b.getAttribute("title")), [
    "Fri, Nov 6: no calls",
    "Sat, Nov 7: nothing paid, 62 calls",
    "Sun, Nov 8: no calls",
    "Mon, Nov 9: no calls",
    "Tue, Nov 10: $8.00 paid",
    "Wed, Nov 11: no calls",
    "Thu, Nov 12: $4.40 paid",
  ]);
  assert.deepEqual(chart.querySelectorAll(".uset-seg").map((/** @type {any} */ x) => [x.className, x.getAttribute("style")]), [["uset-seg is-keys", "height:100%"], ["uset-seg is-keys", "height:55%"]]);
  assert.equal(time.querySelector(".uset-peak").textContent, "Most in a day: $8.00, Tue, Nov 10");
  assert.deepEqual(texts(time, ".uset-axis span"), ["Nov 6", "Nov 12"]);
  assert.equal(time.querySelector(".uset-legend"), null, "one series needs no legend: the pill names it");
  // Another measure is the same read drawn again: the list price stands in two, with its legend.
  const before = s.calls.length;
  press(time, "At list price");
  assert.equal(s.calls.length, before, "no read");
  assert.equal(time.querySelector(".uset-chart").getAttribute("aria-label"), "At list price by day, Nov 6 to Nov 12: $322.62 in all, the most $160.00 on Nov 10.");
  assert.deepEqual(time.querySelectorAll(".uset-bar")[4].querySelectorAll(".uset-seg").map((/** @type {any} */ x) => [x.className, x.getAttribute("style")]), [["uset-seg is-keys", "height:5%"], ["uset-seg is-plans", "height:95%"]]);
  assert.deepEqual(time.querySelectorAll(".uset-legend .uset-key").map((/** @type {any} */ k) => [k.querySelector(".uset-swatch").className, k.textContent]), [["uset-swatch is-keys", "Paid on metered keys"], ["uset-swatch is-plans", "Covered by plans"]]);

  // By account: a real table, a row an account, its models behind a button.
  const accounts = sec(body, "accounts").querySelector("table");
  assert.deepEqual(accounts.querySelectorAll("thead th").map((/** @type {any} */ th) => [th.textContent, th.getAttribute("scope")]), [["Account", "col"], ["Calls", "col"], ["Tokens", "col"], ["Cache hit", "col"], ["Paid", "col"], ["At list price", "col"]]);
  assert.deepEqual(shown(accounts), [
    ["Claude Code · Workplan · Claude Code", "300", "47M", "89%", "$0.00", "$280.00plan"],
    ["Anthropicpay as you go · provider", "72", "7.3M", "85%", "$12.40", "$12.40"],
    ["Codexplan · coding agent", "40", "4.3M", "80%", "$0.00", "$30.22plan"],
  ]);
  assert.deepEqual(accounts.querySelectorAll(".uset-share").map((/** @type {any} */ x) => [x.getAttribute("title"), x.querySelector(".uset-share-fill").getAttribute("style")]), [
    ["80% of this range's tokens", "width:80%"],
    ["13% of this range's tokens", "width:12.6%"],
    ["7% of this range's tokens", "width:7.4%"],
  ]);
  const open = accounts.querySelectorAll("button.uset-open");
  assert.deepEqual(open.map((/** @type {any} */ b) => [b.textContent, b.getAttribute("aria-expanded")]), [["Claude Code · Work", "false"], ["Anthropic", "false"], ["Codex", "false"]]);
  open[1].dispatch("click");
  assert.equal(open[1].getAttribute("aria-expanded"), "true");
  const named = String(open[1].getAttribute("aria-controls")).split(" ");
  assert.equal(named.length, 2);
  assert.ok(named.every((id) => accounts.querySelectorAll("tr").some((/** @type {any} */ tr) => tr.getAttribute("id") === id)), "the button names the rows it opens");
  assert.deepEqual(shown(accounts).slice(1, 4), [
    ["Anthropicpay as you go · provider", "72", "7.3M", "85%", "$12.40", "$12.40"],
    ["claude-opus-5", "52", "7.2M", "86%", "$11.20", "$11.20"],
    ["claude-haiku-4-5", "20", "140k", "0%", "$1.20", "$1.20"],
  ]);
  open[1].dispatch("click");
  assert.equal(open[1].getAttribute("aria-expanded"), "false");
  assert.equal(shown(accounts).length, 3);

  // By model: one row for a model on two accounts; the rest opens under it.
  const models = sec(body, "models").querySelector("table");
  assert.deepEqual(texts(models, "thead th"), ["Model", "Calls", "Input", "Output", "Cache hit", "Paid", "At list price"]);
  assert.deepEqual(shown(models), [
    ["claude-opus-5", "352", "52M", "1.8M", "88%", "$11.20", "$291.20$280.00 plan"],
    ["gpt-5.2-codex", "40", "4M", "300k", "80%", "$0.00", "$30.22plan"],
    ["claude-haiku-4-5", "20", "100k", "40k", "0%", "$1.20", "$1.20"],
  ]);
  const more = models.querySelectorAll("button.uset-open");
  assert.deepEqual(more.map((/** @type {any} */ b) => [b.textContent, b.getAttribute("aria-expanded")]), [["claude-opus-5", "false"], ["gpt-5.2-codex", "false"], ["claude-haiku-4-5", "false"]]);
  more[0].dispatch("click");
  assert.equal(more[0].getAttribute("aria-expanded"), "true");
  const under = models.querySelectorAll("tbody tr").find((/** @type {any} */ tr) => tr.getAttribute("id") === more[0].getAttribute("aria-controls"));
  assert.equal(under.hasAttribute("hidden"), false);
  assert.deepEqual(under.querySelectorAll("dt").map((/** @type {any} */ dt, /** @type {number} */ i) => [dt.textContent, under.querySelectorAll("dd")[i].textContent]), [
    ["Input", "2.5M new · 46M read from cache · 3.5M written to cache"],
    ["Thinking", "400k tokens"],
    ["Average speed", "44.2 tok/s"],
    ["Average to first token", "1.4 s"],
    ["Average call", "11.4 s"],
    ["Failed, stopped", "10 failed · 2 stopped"],
    ["Estimated tokens", "300 calls counted by estimate, not by the provider's own count"],
    ["Asked for as", "claude-code-work/opus ×260, claude-opus-5 ×52, opus ×40"],
    ["Ran on", "Claude Code · Work ×300, Anthropic ×52"],
  ]);

  // Cache.
  const cache = sec(body, "cache");
  assert.deepEqual(cache.querySelectorAll(".set-tile").map((/** @type {any} */ t) => t.children.map((/** @type {any} */ c) => c.textContent)), [
    ["Read from cache", "49M", "input the provider already had"],
    ["Written to cache", "3.5M", "input kept for the calls after"],
    ["Not cached", "3.4M", "input sent as new"],
    ["Hit rate", "88%", "read from cache, of all input"],
  ]);
  assert.deepEqual(cache.querySelector(".uset-saved").children.map((/** @type {any} */ c) => c.textContent), ["What caching saved", "≈ $250.50 at today's list prices"]);
  assert.deepEqual(texts(cache, ".uset-note"), [
    "Cache reads priced as new input, less what they cost as cache reads, less what cache writes cost over new input: by each model's price as it stands today, not as it was on the day.",
    "≈ $240.25 of it is on plans: what those calls would have cost less at list price, not money you paid less.",
    "1 model has no list price and is left out: gpt-5.2-codex.",
  ]);

  // Speed and reliability.
  const speed = sec(body, "speed").querySelector("table");
  assert.deepEqual(texts(speed, "thead th"), ["Account", "Speed", "First token", "A call", "Failed", "Stopped"]);
  assert.deepEqual(shown(speed), [
    ["All accounts", "45.9 tok/s", "1.3 s", "10.8 s", "10 (2%)", "3 (<1%)"],
    ["Claude Code · Work", "45 tok/s", "1.5 s", "12.0 s", "8 (3%)", "2 (<1%)"],
    ["Anthropic", "40 tok/s", "800 ms", "6.2 s", "2 (3%)", "0"],
    ["Codex", "60 tok/s", "1.0 s", "10.0 s", "0", "1 (3%)"],
  ]);

  // When.
  const hours = sec(body, "hours");
  const clock = hours.querySelector(".uset-chart");
  assert.deepEqual([clock.getAttribute("role"), clock.getAttribute("aria-label")], ["img", "Calls by hour of day: 412 calls, the most 120 calls from 14:00 to 15:00."]);
  assert.equal(clock.querySelectorAll(".uset-bar").length, 24);
  assert.equal(clock.querySelectorAll(".uset-bar")[14].getAttribute("title"), "14:00 to 15:00: 120 calls");
  assert.equal(hours.querySelector(".uset-peak").textContent, "Busiest: 14:00 to 15:00, 120 calls.");
  assert.deepEqual(texts(hours, ".uset-axis span"), ["00:00", "06:00", "12:00", "18:00", "24:00"]);

  // Who asked.
  const who = sec(body, "who");
  assert.equal(who.querySelector(".uset-src").textContent, "Kept by the day since Nov 10. A client is the tool that began a turn; a project is the folder its chat works in.");
  const [clients, projects] = who.querySelectorAll("table");
  assert.deepEqual(texts(clients, "thead th"), ["Client", "Calls", "Tokens", "Paid", "At list price"]);
  assert.deepEqual(shown(clients), [["Filament harness", "300", "50M", "$6.00", "$250.00$244.00 plan"], ["OpenCode", "44", "6M", "$5.00", "$5.00"]]);
  assert.deepEqual(texts(projects, "thead th"), ["Project", "Calls", "Tokens", "Paid", "At list price"]);
  assert.deepEqual(shown(projects), [["shop-api", "280", "48M", "$6.00", "$240.00$234.00 plan"], ["No project", "64", "8M", "$5.00", "$15.00$10.00 plan"]]);
  assert.equal(projects.querySelector(".uset-name").getAttribute("title"), "H:\\shop-api · project p1");
  assert.deepEqual(texts(who, ".uset-note"), ["68 of this range's 412 calls are in neither list: who asked is not kept before Nov 10."]);

  // Memory's own calls: read apart, over the same days, and said as no part of the figures above.
  await settle();
  assert.ok(s.calls.includes("/memory/usage?from=2026-11-06&to=2026-11-12"));
  const memory = sec(body, "memory");
  assert.equal(memory.querySelector(".uset-src").textContent, "Memory's model calls — learning from a chat, naming it, compacting — over the same days, kept apart in memory-usage.json. They are in none of the figures above.");
  assert.deepEqual(texts(memory, "thead th"), ["For", "Calls", "Tokens", "Paid", "At list price"]);
  assert.deepEqual(shown(memory.querySelector("table")), [["Learning", "30", "69k", "$0.12", "$0.12"], ["Chat name", "12", "6.6k", "$0.009", "$0.009"]]);
  assert.equal(memory.querySelector(".uset-line").textContent, "42 calls · 76k tokens · $0.13 paid · $0.13 at list price");

  // Tools: the runs that began in the range, and the window said.
  const tools = sec(body, "tools");
  assert.deepEqual(s.calls.filter((p) => p.startsWith("/runs")), ["/runs?limit=200", "/runs/r1/events?since=0&limit=5000", "/runs/r2/events?since=0&limit=5000"]);
  assert.equal(tools.querySelector(".uset-src").textContent, "4 tool calls, from this range's 2 runs: counted from the runs' own events, which are kept apart from the daily record and go back less far.");
  assert.deepEqual(tools.querySelectorAll(".set-break-row").map((/** @type {any} */ r) => [r.querySelector(".set-break-name").textContent, r.querySelector(".set-break-n").textContent]), [["read", "2"], ["bash", "1"], ["edit", "1"]]);
  assert.doesNotMatch(body.textContent, /null|undefined/);

  // A table sits in a box of its own that scrolls sideways and says how many figures a row has: in a column too narrow
  // for them its names keep their room, and no column is dropped.
  assert.deepEqual(body.querySelectorAll("table").map((/** @type {any} */ t) => [t.parentNode.getAttribute("class"), t.getAttribute("class")]),
    [["uset-scroll", "uset-table is-figs-5"], ["uset-scroll", "uset-table is-figs-6"], ["uset-scroll", "uset-table is-figs-5"], ["uset-scroll", "uset-table is-figs-4"], ["uset-scroll", "uset-table is-figs-4"], ["uset-scroll", "uset-table is-figs-4"]]);
});

// (fails before: yes — the range was 7 days, 30 days or all time, and a change wiped the page to "Loading…")
test("a range change reads once more and never flashes empty; a read that comes late is not drawn over a newer one", async () => {
  const hold = { "/usage/breakdown?days=1": held(), "/usage/breakdown?days=7": held() };
  const s = server({ hold });
  const body = page();
  renderUsage(body, {}, { api: s.api });
  hold["/usage/breakdown?days=7"].open();
  await settle();
  assert.equal(sec(body, "totals").querySelector(".set-tile-value").textContent, "412");
  // Today is asked for; until it lands the week stays drawn, marked as being read.
  press(body, "Today");
  await settle();
  assert.equal(s.calls.filter((p) => p.startsWith("/usage/breakdown")).at(-1), "/usage/breakdown?days=1");
  assert.equal(body.querySelector(".uset-main").getAttribute("aria-busy"), "true");
  assert.equal(sec(body, "totals").querySelector(".set-tile-value").textContent, "412");
  assert.equal(sec(body, "accounts").querySelectorAll("tbody tr").length > 0, true);
  // The person goes back to the week before today's read lands: the week is read again, and today's answer, late, is dropped.
  hold["/usage/breakdown?days=7"] = held();
  press(body, "Last 7 days");
  await settle();
  hold["/usage/breakdown?days=1"].open();
  await settle();
  assert.equal(sec(body, "totals").querySelector(".set-tile-value").textContent, "412", "today's late answer is not drawn");
  assert.equal(body.querySelector(".uset-main").getAttribute("aria-busy"), "true", "the week is still on its way");
  hold["/usage/breakdown?days=7"].open();
  await settle();
  assert.equal(body.querySelector(".uset-main").getAttribute("aria-busy"), "false");
  assert.equal(sec(body, "time").querySelector(".uset-src").classList.contains("hidden"), false);
  // Today, landed: one day has no row of days to draw, and says where its hours are.
  hold["/usage/breakdown?days=1"] = held();
  press(body, "Today");
  hold["/usage/breakdown?days=1"].open();
  await settle();
  assert.equal(sec(body, "totals").querySelector(".set-tile-value").textContent, "20");
  assert.equal(sec(body, "totals").querySelector(".uset-src").textContent, "From the daily record, today: every model call that finished through this Filament, its memory's own aside.");
  assert.equal(sec(body, "time").querySelector(".uset-chart"), null);
  assert.deepEqual(texts(sec(body, "time"), ".uset-none"), ["One day: its hours are under When."]);
  assert.equal(sec(body, "time").querySelector(".uset-src").classList.contains("hidden"), true, "the line that says what a bar is goes with the bars");
  assert.deepEqual(texts(sec(body, "cache"), ".uset-note"), ["No call in this range read from a cache or wrote to one."]);
  assert.deepEqual(texts(sec(body, "who"), ".uset-none"), ["No call of this range was booked on a project."]);
  // A part a range has none of — no sentence under the money, no note on who asked — leaves no word behind.
  assert.doesNotMatch(body.textContent, /null|undefined/);
  assert.deepEqual(sec(body, "who").querySelector(".uset-body").childNodes.map((/** @type {any} */ n) => n.nodeType), [1, 1]);
});

// (fails before: yes — a failed read left "Loading…" gone and its error where the tiles were, the rest blank)
test("a read that fails says so in place, in the server's words, and what was drawn stays", async () => {
  const fail = /** @type {Record<string, string>} */ ({});
  const s = server({ fail });
  const body = page();
  renderUsage(body, {}, { api: s.api });
  await settle();
  assert.equal(body.querySelector(".set-error"), null);
  fail["/usage/breakdown?days=1"] = "the usage file could not be read";
  press(body, "Today");
  await settle();
  const said = body.querySelector(".uset-head-fail");
  assert.deepEqual([said.textContent, said.getAttribute("role")], ["Today could not be read: the usage file could not be read. The page still shows Last 7 days.", "alert"]);
  assert.equal(sec(body, "totals").querySelector(".set-tile-value").textContent, "412");
  assert.equal(body.querySelector(".uset-main").getAttribute("aria-busy"), "false");
  assert.equal(body.querySelector(".zc-pills[aria-label='Range'] .zc-pill.on").textContent, "Last 7 days", "the range's pill says what is drawn");
  // The next read that lands takes the words away.
  delete fail["/usage/breakdown?days=1"];
  press(body, "Last 7 days");
  await settle();
  assert.equal(body.querySelector(".uset-head-fail"), null);

  // Memory's own read and the runs' fail in their own sections; the rest is whole.
  const t = server({ fail: { "/memory/usage?from=2026-11-06&to=2026-11-12": "only a device that may drive reads memory's usage", "/runs?limit=200": "the runs could not be listed" } });
  const other = page();
  renderUsage(other, {}, { api: t.api });
  await settle();
  assert.equal(sec(other, "totals").querySelector(".set-tile-value").textContent, "412");
  assert.deepEqual(texts(sec(other, "memory"), ".set-error"), ["Memory's own calls could not be read: only a device that may drive reads memory's usage"]);
  assert.deepEqual(texts(sec(other, "tools"), ".set-error"), ["The runs could not be read: the runs could not be listed"]);

  // The first read of all fails: the frames stand, and the words say so.
  const u = server({ fail: { "/usage/breakdown?days=7": "Filament is restarting" } });
  const first = page();
  renderUsage(first, {}, { api: u.api });
  await settle();
  assert.equal(first.querySelector(".uset-head-fail").textContent, "Last 7 days could not be read: Filament is restarting.");
  assert.equal(texts(first, ".uset-h").length, 10);
});

// (fails before: yes — an empty file drew six tiles of zeros and an empty chart)
test("nothing on record, a range with no call, a section with none: each says so in a line", async () => {
  const empty = { ...WEEK, kept: { days: 0, first: null, last: null, keepDays: 400, file: null }, days: [], total: totalOf([]), accounts: {}, cache: { usd: null, plan: 0, models: 0, unpriced: [], flat: [] }, who: { since: null, days: 0, requests: 0, clients: [], projects: [] } };
  const s = server({ week: empty, memory: { total: totalOf([]) }, runs: [] });
  const body = page();
  renderUsage(body, {}, { api: s.api });
  await settle();
  assert.equal(body.querySelector(".uset-empty").textContent, NOTHING_YET);
  assert.equal(body.querySelector(".uset-kept").textContent, "");
  assert.equal(body.querySelector(".uset-kept").hasAttribute("title"), false);
  assert.deepEqual(texts(body, ".uset-h"), ["Memory's own calls", "Tools"], "the range's own sections give way to the line");
  assert.deepEqual(texts(sec(body, "memory"), ".uset-none"), ["No call of memory's own in this range."]);
  assert.deepEqual(texts(sec(body, "tools"), ".uset-none"), ["No run began in this range."]);
  assert.equal(sec(body, "tools").querySelector(".uset-src").textContent, "Counted from the runs' own events, which are kept apart from the daily record and go back less far.");

  // Days on record, none in the range.
  const quiet = { ...empty, kept: { days: 12, first: "2026-10-20", last: "2026-11-01", keepDays: 400, file: null } };
  const t = server({ week: quiet, memory: { total: totalOf([]) }, runs: [{ id: "r2", startedAt: Date.parse("2026-11-10T09:00:00") }] });
  const other = page();
  renderUsage(other, {}, { api: t.api });
  await settle();
  assert.equal(other.querySelector(".uset-empty").textContent, "No calls in this range. The newest day on record is Nov 1.");
  assert.equal(other.querySelector(".uset-kept").textContent, "12 days on record, from Oct 20");
  assert.equal(sec(other, "tools").querySelector(".uset-src").textContent, "1 tool call, from this range's 1 run: counted from the runs' own events, which are kept apart from the daily record and go back less far.");
});

// (fails before: yes — the page had no export)
test("Export CSV asks for the days of the range that is drawn", async () => {
  const s = server();
  /** @type {string[]} */
  const saved = [];
  const body = page();
  renderUsage(body, {}, { api: s.api, download: async (path) => void saved.push(path) });
  const csv = body.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Export CSV");
  assert.ok(csv);
  assert.equal(csv.hasAttribute("disabled"), true, "nothing to export until a range is read");
  await settle();
  assert.equal(csv.hasAttribute("disabled"), false);
  csv.dispatch("click");
  await settle();
  assert.deepEqual(saved, ["/usage/days.csv?from=2026-11-06&to=2026-11-12"]);
  // A download that fails is said, in its own words.
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  const other = page();
  renderUsage(other, { onToast: (msg, kind) => void toasts.push([msg, kind]) }, { api: s.api, download: async () => { throw new Error("disk full"); } });
  await settle();
  press(other, "Export CSV");
  await settle();
  assert.deepEqual(toasts, [["The CSV could not be saved: disk full", "err"]]);
});

// (fails before: yes — "this page reads that file and sends nothing anywhere" was true of the page and read as true of
// the record, whose day's sums Anonymous usage statistics sends once a day where it is on: services/telemetry.js)
test("the page's line says what is counted, where it is kept and for how long, and what of it leaves this computer", () => {
  assert.equal(
    DESCRIPTIONS.usage,
    "Every model call that went through this Filament — its own chats' and any tool's that uses it as its endpoint — counted as it finished and kept on this computer for 400 days (daily-usage.json in the data folder). This page sends nothing: a day's counts leave this computer only where Anonymous usage statistics is on, in Data and privacy.",
  );
  // The switch and the page it names, by their own names.
  assert.ok(DATA_ROWS.some((r) => r.path === "telemetry.enabled" && DESCRIPTIONS.usage.includes(String(r.label))));
  assert.ok(DESCRIPTIONS.usage.includes(String(SECTIONS.find((s) => s.id === "data")?.label)));
});
