// @ts-check
// What Settings › Usage stats says of a span of days (the owner's of 11-12): pure functions from the server's answer
// (`GET /usage/breakdown`, app/usage-breakdown.js) to the words, the figures and the bars the page draws. Every figure
// is one the server gave or a sum of its rows; a day is read as its own string, and no clock is read here but the
// `today` the answer carries.
import { fmt, projectWords, upstreamWords } from "../../lib/format.js";

/** The ranges the page offers, the newest days first; `days` 0 is every day on record. */
export const RANGES = Object.freeze([
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "all", label: "All time", days: 0 },
]);

/** The read a range asks for: the server counts the days back from its own today. @param {string} id */
export function breakdownPath(id) {
  const days = RANGES.find((r) => r.id === id)?.days ?? 7;
  return `/usage/breakdown${days ? `?days=${days}` : ""}`;
}
/** @param {{ from?: string | null, to?: string | null }} b */
const spanQuery = (b) => {
  const q = [b.from ? `from=${b.from}` : "", b.to ? `to=${b.to}` : ""].filter(Boolean).join("&");
  return q ? `?${q}` : "";
};
/** The CSV of the span an answer covers. @param {{ from?: string | null, to?: string | null }} b */
export const csvPath = (b) => `/usage/days.csv${spanQuery(b)}`;
/** Memory's own calls over the same span. @param {{ from?: string | null, to?: string | null }} b */
export const memoryPath = (b) => `/memory/usage${spanQuery(b)}`;

// ---- figures ------------------------------------------------------------------------------------------------

/** A count, whole, with its thousands apart. @param {any} n */
export const count = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
/** A count with its noun: "1 call", "412 calls". @param {any} n @param {string} one @param {string} [many] */
const some = (n, one, many = `${one}s`) => `${count(n)} ${Math.round(Number(n) || 0) === 1 ? one : many}`;

/** Tokens in a word's room, as `fmt.k` says them, and billions past it: 840, 4.1k, 58M, 1.2B. @param {any} n */
export function tokens(n) {
  const v = Math.round(Number(n) || 0);
  return v >= 999_500_000 ? `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B` : fmt.k(v);
}

/**
 * Dollars: to the cent from a dime up, with the thousands apart; more places below it, where a day's calls are often a
 * fraction of a cent; a dash for a figure nothing named — never $0.
 * @param {number | null | undefined} v
 */
export function money(v) {
  if (v == null) return "–";
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a === 0) return "$0.00";
  if (a >= 0.095) return `${sign}$${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (a < 0.00005) return `${sign}<$0.0001`;
  return `${sign}$${a.toFixed(a >= 0.00995 ? 3 : 4).replace(/(\.\d\d\d*?)0+$/, "$1")}`;
}

/** A share as a whole percent: "<1%" for a sliver that is not nothing, a dash of nothing. @param {number} part @param {number} whole */
export function share(part, whole) {
  if (!(whole > 0)) return "–";
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/** How long something took: "840 ms", "8.4 s", "2 min 5 s"; a dash where no call said. @param {number | null | undefined} ms */
export function tookWords(ms) {
  if (ms == null) return "–";
  const v = Math.round(Number(ms) || 0);
  if (v < 1000) return `${v} ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)} s`;
  const s = Math.round(v / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** A mean over the calls that reported the figure, or null where none did. @param {number} sum @param {number} n */
const mean = (sum, n) => (n > 0 ? sum / n : null);
/** @param {number | null} tps */
const speedWords = (tps) => (tps == null ? "–" : `${Math.round(tps * 10) / 10} tok/s`);
/** A part of a whole as a bar's length, in tenths of a percent. @param {number} v @param {number} max */
const lengthOf = (v, max) => (max > 0 ? Math.round((v * 1000) / max) / 10 : 0);

// ---- days ---------------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** @param {string} day  2026-11-03 */
const ymd = (day) => String(day).split("-").map(Number);
/** The day after, by the calendar. @param {string} day */
const dayAfter = (day) => {
  const [y, m, d] = ymd(day);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** A day in words: "Nov 3", with its year where that is not today's. @param {string} day @param {string} [today] */
export function dayWords(day, today = "") {
  const [y, m, d] = ymd(day);
  return `${MONTHS[m - 1]} ${d}${today && !today.startsWith(`${y}-`) ? `, ${y}` : ""}`;
}
/** A day with its weekday: "Tue, Nov 3". @param {string} day @param {string} [today] */
export function weekdayWords(day, today = "") {
  const [y, m, d] = ymd(day);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${dayWords(day, today)}`;
}
/** When a day begins on this computer, in epoch ms: what started since is the day's. @param {string} day */
export function dayStart(day) {
  const [y, m, d] = ymd(day);
  return new Date(y, m - 1, d).getTime();
}

/**
 * The days an answer covers, as a section's source line says them: "today", "Nov 6 to Nov 12", and for every day on
 * record the first of them, "since Sep 29".
 * @param {any} b  the server's answer
 */
export function spanWords(b) {
  if (b.from && b.from === b.to) return b.from === b.today ? "today" : dayWords(b.from, b.today);
  if (b.from && b.to) return `${dayWords(b.from, b.today)} to ${dayWords(b.to, b.today)}`;
  return b.kept?.first ? `since ${dayWords(b.kept.first, b.today)}` : "all time";
}

/** What is on record, said beside All time. @param {{ days?: number, first?: string | null } | null | undefined} kept @param {string} today */
export function keptWords(kept, today) {
  return kept?.days && kept.first ? `${some(kept.days, "day")} on record, from ${dayWords(kept.first, today)}` : "";
}

/**
 * Where what is on record is kept, as that line's tip: the file, and how many days it holds — the newest that had a
 * call, a day without one taking no room. Nothing where no file is written or nothing is on record.
 * @param {{ days?: number, keepDays?: number, file?: string | null } | null | undefined} kept
 */
export function keptTip(kept) {
  return kept?.days && kept.file ? `Kept in ${kept.file}: the newest ${count(kept.keepDays)} days that had a call.` : "";
}

export const NOTHING_YET ="Nothing yet: usage is counted from the first model call through Filament.";
/**
 * What stands in the sections' place where the range has no call: nothing on record at all, or none in these days —
 * with the newest day that has some. Null where there is something to show.
 * @param {any} b  the server's answer
 */
export function emptyWords(b) {
  if (!b?.kept?.days) return NOTHING_YET;
  if (b.total?.requests) return null;
  const when = b.from && b.from === b.to ? (b.from === b.today ? "today" : `on ${dayWords(b.from, b.today)}`) : "in this range";
  return `No calls ${when}. The newest day on record is ${dayWords(b.kept.last, b.today)}.`;
}

// ---- rows ---------------------------------------------------------------------------------------------------

/** The sums a row carries, as the daily store counts them. */
const SUMS = ["requests", "ok", "errors", "aborted", "input", "cacheRead", "cacheWrite", "output", "thinking", "cost", "costN", "listCost", "listCostN", "planListCost", "tpsSum", "tpsN", "ttftSum", "ttftN", "msSum", "estimated"];
/** @param {any[]} rows @param {string} k */
const sumOf = (rows, k) => rows.reduce((n, r) => n + (Number(r?.[k]) || 0), 0);
/** Rows added up. @param {any[]} rows @returns {Record<string, number>} */
const added = (rows) => Object.fromEntries(SUMS.map((k) => [k, sumOf(rows, k)]));
/** Rows by a name of theirs, in the order first met. @param {any[]} rows @param {(r: any) => string} nameOf @returns {Map<string, any[]>} */
const groupedBy = (rows, nameOf) => {
  /** @type {Map<string, any[]>} */
  const out = new Map();
  for (const r of rows) out.set(nameOf(r), [...(out.get(nameOf(r)) || []), r]);
  return out;
};
/** Everything sent in: new, read from cache and written to it. @param {any} b */
const inputOf = (b) => (b.input || 0) + (b.cacheRead || 0) + (b.cacheWrite || 0);
/** @param {any} b */
const tokensOf = (b) => inputOf(b) + (b.output || 0);
/** The biggest first: by tokens, then by calls. @param {{ tokens: number, calls: number }} a @param {{ tokens: number, calls: number }} b */
const biggestFirst = (a, b) => b.tokens - a.tokens || b.calls - a.calls;

/** The plan's part of a list price, said beside it: all of it, or how much. @param {any} b */
const planMark = (b) => (!(b.planListCost > 0) ? "" : b.planListCost >= (b.listCost || 0) - 5e-7 ? "plan" : `${money(b.planListCost)} plan`);
/**
 * What was paid and the list price: a dash where no call named one. Calls that named no charge and whose whole list
 * price a plan covered paid nothing by the token: $0, as the totals count them.
 * @param {any} b
 */
const priceCells = (b) => ({ paid: b.costN ? money(b.cost) : planMark(b) === "plan" ? money(0) : "–", list: b.listCostN ? money(b.listCost) : "–", plan: planMark(b) });
/** A row's cells, as its table says them. @param {any} b */
const cellsOf = (b) => ({ calls: count(b.requests), tokens: tokens(tokensOf(b)), input: tokens(inputOf(b)), output: tokens(b.output), cacheHit: share(b.cacheRead || 0, inputOf(b)), ...priceCells(b) });

/** @param {Record<string, any> | null | undefined} accounts @param {string} id */
const accountOf = (accounts, id) => (accounts && Object.hasOwn(accounts, id) ? accounts[id] : null);
/**
 * Whether a plan paid for a row's calls: by what the calls themselves said where they named a list price — more of it a
 * plan's than not —, else by how the row's account bills.
 * @param {any} r @param {Record<string, any> | null | undefined} accounts
 */
const onPlan = (r, accounts) => (r.listCost > 0 ? r.planListCost * 2 >= r.listCost : accountOf(accounts, r.upstream)?.billing === "plan");

const BILLING_WORDS = Object.freeze({ plan: "plan", metered: "pay as you go" });
/**
 * An account in words: its name as a person knows it, and what it is — how it bills, and which coding agent or
 * provider it is an account of where its name does not say so.
 * @param {string} id @param {Record<string, any> | null | undefined} accounts
 * @returns {{ name: string, what: string }}
 */
export function accountWords(id, accounts) {
  const own = upstreamWords(id);
  if (own) return { name: own, what: "Filament's own turn, no provider's" };
  const a = accountOf(accounts, id);
  if (!a || a.kind === "gone") return id === "?" ? { name: "Unknown", what: "calls that named no account" } : { name: String(a?.name || id), what: "no longer set up" };
  if (a.kind === "machine") return { name: String(a.name), what: "another computer's Filament" };
  const named = a.of && a.of !== a.name ? String(a.of) : a.kind === "agent" ? "coding agent" : "provider";
  return { name: String(a.name), what: [Object.hasOwn(BILLING_WORDS, a.billing) ? BILLING_WORDS[/** @type {keyof typeof BILLING_WORDS} */ (a.billing)] : "", named].filter(Boolean).join(" · ") };
}

// ---- totals -------------------------------------------------------------------------------------------------

/** @typedef {{ key: string, label: string, value: string, line: string }} Tile */

/**
 * The totals: the calls, the tokens and the cache in one row of tiles, the money in the next — paid, covered by plans,
 * at list price, each with the line that says which it is — and the one sentence under the money that says the three
 * apart, only the parts that are not nothing.
 * @param {any} total  the span's sums and rows @param {Record<string, any>} accounts
 * @returns {{ work: Tile[], money: Tile[], sentence: string }}
 */
export function totalsView(total, accounts) {
  const rows = total.rows || [];
  const planCalls = sumOf(rows.filter((/** @type {any} */ r) => onPlan(r, accounts)), "requests");
  // Calls on a key that named no price: they are in neither Paid nor At list price, and the page says how many.
  const unpriced = rows.filter((/** @type {any} */ r) => !onPlan(r, accounts)).reduce((/** @type {number} */ n, /** @type {any} */ r) => n + Math.max(0, r.requests - r.costN), 0);
  const cents = (/** @type {number} */ v) => Math.round(v * 100);
  const said = [];
  if (total.cost > 0) said.push(`You paid ${money(total.cost)}.`);
  if (total.planListCost > 0) said.push(`Your plans covered calls worth ${money(total.planListCost)} at list price.`);
  if (total.cost > 0 && total.planListCost > 0) said.push(`All of it at list price: ${money(total.listCost)}.`);
  else if (total.listCost > 0 && !(total.planListCost > 0) && cents(total.listCost) !== cents(total.cost)) said.push(`At list price it comes to ${money(total.listCost)}.`);
  if (!said.length && total.requests) said.push("No call here named a price.");
  else if (unpriced > 0) said.push(`${some(unpriced, "call")} named no price and ${unpriced === 1 ? "is" : "are"} in none of these figures.`);
  return {
    work: [
      { key: "calls", label: "Calls", value: count(total.requests), line: `${count(total.errors)} failed · ${count(total.aborted)} stopped` },
      { key: "tokens", label: "Tokens through Filament", value: tokens(tokensOf(total)), line: `in ${tokens(inputOf(total))} · out ${tokens(total.output)}` },
      { key: "cache", label: "Cache hit rate", value: share(total.cacheRead || 0, inputOf(total)), line: `${tokens(total.cacheRead)} read from cache` },
    ],
    money: [
      { key: "paid", label: "Paid", value: !total.costN && unpriced > 0 ? "–" : money(total.cost), line: planCalls ? `${some(planCalls, "call")} on plans paid nothing here` : "every call was pay as you go" },
      {
        key: "plans",
        label: "Covered by plans",
        value: planCalls && !(total.planListCost > 0) ? "–" : money(total.planListCost),
        line: !planCalls ? "no call was on a plan" : total.planListCost > 0 ? "what those calls are worth at list price" : `its ${some(planCalls, "call")} named no list price`,
      },
      {
        key: "list",
        label: "At list price",
        value: total.listCostN ? money(total.listCost) : "–",
        line: !total.listCostN ? "no call named a list price" : total.listCostN < total.requests ? `of ${some(total.listCostN, "call")}: the rest named no price` : "plans and keys together",
      },
    ],
    sentence: said.join(" "),
  };
}

// ---- over time ----------------------------------------------------------------------------------------------

/** What the bars by day can show. */
export const MEASURES = Object.freeze([
  { id: "cost", label: "Paid" },
  { id: "list", label: "At list price" },
  { id: "tokens", label: "Tokens" },
  { id: "calls", label: "Calls" },
]);
/** The measure a range opens on: what was paid, else the list price a plan covered, else the tokens. @param {any} total */
export const measureFor = (total) => (total?.cost > 0 ? "cost" : total?.listCost > 0 ? "list" : "tokens");

/** @typedef {{ day: string, requests: number, cost: number, listCost: number, planListCost: number, totalTokens: number }} DaySlot */

/**
 * A slot for every day of the answer's span, the oldest first, with nothing in those that had no call: all time runs
 * from the first day on record to today.
 * @param {any} b  the server's answer @returns {DaySlot[]}
 */
export function daySlots(b) {
  const from = b.from || b.kept?.first;
  const to = b.to || b.today;
  if (!from || !to) return [];
  const have = new Map((b.days || []).map((/** @type {any} */ d) => [d.day, d]));
  /** @type {DaySlot[]} */
  const out = [];
  // No more slots than days the file keeps, and today's: a span that names an older first day draws no longer row.
  for (let day = String(from), n = 0; day <= to && n <= (b.kept?.keepDays || 400); day = dayAfter(day), n++) {
    const d = have.get(day);
    out.push({ day, requests: d?.requests || 0, cost: d?.cost || 0, listCost: d?.listCost || 0, planListCost: d?.planListCost || 0, totalTokens: d?.totalTokens || 0 });
  }
  return out;
}

const STACK = Object.freeze([{ key: "keys", label: "Paid on metered keys" }, { key: "plans", label: "Covered by plans" }]);
/**
 * The bars by day for a measure: each day's parts as lengths against the biggest day (tenths of a percent), its tip in
 * words, the chart's own sentence for a reader that sees no bar (`label`), and the biggest day said (`peak`). The list
 * price stands in two parts — what was paid on metered keys, what plans covered — with their legend; the others in one.
 * @param {DaySlot[]} slots @param {string} measure  one of MEASURES' @param {string} today
 */
export function dayBars(slots, measure, today) {
  const m = MEASURES.find((x) => x.id === measure) || MEASURES[0];
  /** @type {(d: DaySlot) => number} */
  const valueOf = m.id === "cost" ? (d) => d.cost : m.id === "list" ? (d) => d.listCost : m.id === "tokens" ? (d) => d.totalTokens : (d) => d.requests;
  /** @type {(v: number) => string} */
  const say = m.id === "tokens" ? (v) => `${tokens(v)} tokens` : m.id === "calls" ? (v) => some(v, "call") : (v) => money(v);
  const max = Math.max(0, ...slots.map(valueOf));
  const top = slots.find((d) => max > 0 && valueOf(d) === max) || null;
  const bars = slots.map((d) => {
    const value = valueOf(d);
    const keys = Math.max(0, d.listCost - d.planListCost);
    const parts =
      m.id === "list"
        ? [{ key: "keys", value: keys }, { key: "plans", value: d.planListCost }].filter((p) => p.value > 0).map((p) => ({ ...p, pct: lengthOf(p.value, max) }))
        : value > 0
          ? [{ key: m.id === "cost" ? "keys" : "all", value, pct: lengthOf(value, max) }]
          : [];
    const when = weekdayWords(d.day, today);
    const tip = !d.requests
      ? `${when}: no calls`
      : m.id === "cost"
        ? value > 0 ? `${when}: ${money(value)} paid` : `${when}: nothing paid, ${some(d.requests, "call")}`
        : m.id === "list"
          ? !(value > 0)
            ? `${when}: no list price named, ${some(d.requests, "call")}`
            : parts.length === 2
              ? `${when}: ${money(value)} at list price (${money(keys)} on metered keys, ${money(d.planListCost)} covered by plans)`
              : `${when}: ${money(value)} at list price, all of it ${parts[0]?.key === "plans" ? "covered by plans" : "on metered keys"}`
          : `${when}: ${say(value)}`;
    return { day: d.day, value, parts, tip };
  });
  const first = slots.length ? dayWords(slots[0].day, today) : "";
  const last = slots.length ? dayWords(slots[slots.length - 1].day, today) : "";
  const span = first === last ? first : `${first} to ${last}`;
  return {
    max,
    bars,
    legend: m.id === "list" ? [...STACK] : null,
    label: `${m.label} by day, ${span}: ${top ? `${say(slots.reduce((n, d) => n + valueOf(d), 0))} in all, the most ${say(max)} on ${dayWords(top.day, today)}.` : "nothing."}`,
    peak: top ? `Most in a day: ${say(max)}, ${weekdayWords(top.day, today)}` : "",
    first,
    last,
  };
}

// ---- by account, by model -----------------------------------------------------------------------------------

/**
 * A row per account, the biggest by tokens first: its name and what it is, its share of the range's tokens, its cells,
 * and its models under it.
 * @param {any} total @param {Record<string, any>} accounts
 */
export function accountRows(total, accounts) {
  const all = tokensOf(total);
  return [...groupedBy(total.rows || [], (r) => String(r.upstream))]
    .map(([id, rows]) => {
      const b = added(rows);
      return {
        id,
        ...accountWords(id, accounts),
        tokens: tokensOf(b),
        calls: b.requests,
        share: all > 0 ? tokensOf(b) / all : 0,
        shareWords: `${share(tokensOf(b), all)} of this range's tokens`,
        cells: cellsOf(b),
        models: rows.map((r) => ({ model: String(r.model), tokens: tokensOf(r), calls: r.requests, cells: cellsOf(r) })).sort(biggestFirst),
      };
    })
    .sort(biggestFirst);
}

/** Names with how often each, the most first; past `most` they are counted. @param {{ name: string, n: number }[]} list @param {number} [most] */
const timesWords = (list, most = 6) => {
  const sorted = [...list].sort((a, b) => b.n - a.n);
  return sorted.slice(0, most).map((x) => `${x.name} ×${count(x.n)}`).join(", ") + (sorted.length > most ? `, and ${count(sorted.length - most)} more` : "");
};

/**
 * A row per model, by the upstream's own name for it, whatever accounts ran it — the biggest by tokens first —, and
 * what its disclosure opens to: the input's parts, thinking, the averages, failed and stopped, the calls whose tokens
 * are an estimate, the names it was asked for by, the accounts it ran on.
 * @param {any} total @param {Record<string, any>} accounts
 */
export function modelRows(total, accounts) {
  return [...groupedBy(total.rows || [], (r) => String(r.model))]
    .map(([model, rows]) => {
      const b = added(rows);
      /** @type {Map<string, number>} */
      const asked = new Map();
      for (const r of rows) for (const a of r.asked || []) asked.set(String(a.name), (asked.get(String(a.name)) || 0) + (Number(a.n) || 0));
      const ran = [...groupedBy(rows, (r) => String(r.upstream))].map(([id, own]) => ({ name: accountWords(id, accounts).name, n: sumOf(own, "requests") }));
      return {
        model,
        tokens: tokensOf(b),
        calls: b.requests,
        cells: cellsOf(b),
        details: [
          { label: "Input", value: `${tokens(b.input)} new · ${tokens(b.cacheRead)} read from cache · ${tokens(b.cacheWrite)} written to cache` },
          { label: "Thinking", value: `${tokens(b.thinking)} tokens` },
          { label: "Average speed", value: speedWords(mean(b.tpsSum, b.tpsN)) },
          { label: "Average to first token", value: tookWords(mean(b.ttftSum, b.ttftN)) },
          { label: "Average call", value: tookWords(mean(b.msSum, b.requests)) },
          { label: "Failed, stopped", value: `${count(b.errors)} failed · ${count(b.aborted)} stopped` },
          { label: "Estimated tokens", value: b.estimated ? `${some(b.estimated, "call")} counted by estimate, not by the provider's own count` : "none: every call's tokens are its provider's own count" },
          { label: "Asked for as", value: timesWords([...asked].map(([name, n]) => ({ name, n }))) },
          { label: "Ran on", value: timesWords(ran) },
        ],
      };
    })
    .sort(biggestFirst);
}

// ---- cache --------------------------------------------------------------------------------------------------

/** A few names, the rest counted: "a, b, c, d and 2 more". @param {string[]} names */
const namesWords = (names) => (names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${count(names.length - 4)} more` : names.join(", "));

/**
 * The cache's figures — read, written, not cached, the hit rate — and what caching saved, as the server worked it out
 * (`cacheSaved`): an estimate at the prices as they stand today, said as one, with the part on plans said apart and
 * the models left out named.
 * @param {any} total @param {{ usd: number | null, plan?: number, models?: number, unpriced?: string[], flat?: string[] } | null | undefined} cache
 * @returns {{ figures: Tile[], saved: string, lines: string[], none: boolean }}
 */
export function cacheView(total, cache) {
  const figures = [
    { key: "read", label: "Read from cache", value: tokens(total.cacheRead), line: "input the provider already had" },
    { key: "written", label: "Written to cache", value: tokens(total.cacheWrite), line: "input kept for the calls after" },
    { key: "new", label: "Not cached", value: tokens(total.input), line: "input sent as new" },
    { key: "rate", label: "Hit rate", value: share(total.cacheRead || 0, inputOf(total)), line: "read from cache, of all input" },
  ];
  if (!(total.cacheRead || total.cacheWrite)) return { figures, saved: "–", lines: ["No call in this range read from a cache or wrote to one."], none: true };
  const usd = cache?.usd ?? null;
  const lines = [];
  if (usd != null && usd < 0) lines.push("Writing to the cache cost more here than reading from it saved: cache writes are priced over new input, cache reads under it, by each model's price as it stands today.");
  else if (usd != null) lines.push("Cache reads priced as new input, less what they cost as cache reads, less what cache writes cost over new input: by each model's price as it stands today, not as it was on the day.");
  if (usd != null && usd > 0 && Number(cache?.plan) > 0) lines.push(`≈ ${money(cache?.plan)} of it is on plans: what those calls would have cost less at list price, not money you paid less.`);
  const unpriced = cache?.unpriced || [];
  const flat = cache?.flat || [];
  if (unpriced.length) lines.push(`${unpriced.length === 1 ? "1 model has" : `${count(unpriced.length)} models have`} no list price and ${unpriced.length === 1 ? "is" : "are"} left out: ${namesWords(unpriced)}.`);
  if (flat.length) lines.push(`${flat.length === 1 ? "1 model costs" : `${count(flat.length)} models cost`} the same read from cache or not on ${flat.length === 1 ? "its card" : "their cards"}, so there is no saving to say: ${namesWords(flat)}.`);
  return { figures, saved: usd == null ? "–" : usd < 0 ? `≈ ${money(-usd)} more, at today's list prices` : `≈ ${money(usd)} at today's list prices`, lines, none: false };
}

// ---- speed, hours -------------------------------------------------------------------------------------------

/**
 * Speed and reliability: the averages over the calls that reported them, failed and stopped as counts with their
 * share of the calls — for the range, and for each account, the busiest first.
 * @param {any} total @param {Record<string, any>} accounts
 */
export function speedView(total, accounts) {
  /** @param {number} n @param {number} of */
  const part = (n, of) => (n ? `${count(n)} (${share(n, of)})` : "0");
  /** @param {string} name @param {any} b */
  const line = (name, b) => ({
    name,
    cells: { speed: speedWords(mean(b.tpsSum, b.tpsN)), first: tookWords(mean(b.ttftSum, b.ttftN)), call: tookWords(mean(b.msSum, b.requests)), failed: part(b.errors, b.requests), stopped: part(b.aborted, b.requests) },
  });
  const by = [...groupedBy(total.rows || [], (r) => String(r.upstream))].map(([id, rows]) => ({ id, b: added(rows) })).sort((a, b) => b.b.requests - a.b.requests);
  return { all: line("All accounts", total), accounts: by.map(({ id, b }) => line(accountWords(id, accounts).name, b)) };
}

/** An hour of the day and the one after: "14:00 to 15:00". @param {number} h */
const hourSpan = (h) => `${String(h).padStart(2, "0")}:00 to ${String((h + 1) % 24).padStart(2, "0")}:00`;
/**
 * The calls by hour of day, 24 bars against the busiest hour, each with its tip; the busiest said, and the chart's own
 * sentence for a reader that sees no bar.
 * @param {number[] | null | undefined} hours
 */
export function hourBars(hours) {
  const list = Array.from({ length: 24 }, (_, i) => Number(hours?.[i]) || 0);
  const max = Math.max(0, ...list);
  const at = list.indexOf(max);
  const all = list.reduce((n, v) => n + v, 0);
  return {
    max,
    bars: list.map((value, hour) => ({ hour, value, pct: lengthOf(value, max), tip: `${hourSpan(hour)}: ${value ? some(value, "call") : "no calls"}` })),
    busiest: max ? `Busiest: ${hourSpan(at)}, ${some(max, "call")}.` : "",
    label: max ? `Calls by hour of day: ${some(all, "call")}, the most ${some(max, "call")} from ${hourSpan(at)}.` : "Calls by hour of day: none.",
  };
}

// ---- who asked ----------------------------------------------------------------------------------------------

// The daily store's own names (services/daily-usage.js): the rest of a day past the names it keeps, a call that
// named no client, a call booked on no project (core/project-id.js).
const WHO_OTHER = "other";
const NO_CLIENT = "unknown";
const NO_PROJECT = "none";

/**
 * Who asked, by client and by project: each row in words with its share of what was counted, and — where the range has
 * calls no day counted by who asked — how many, and the day from which it is kept.
 * @param {any} b  the server's answer
 */
export function whoView(b) {
  const who = b.who || {};
  const total = b.total?.requests || 0;
  /** @param {any[]} list @param {(r: any) => { name: string, title: string }} wordsOf */
  const rowsOf = (list, wordsOf) => {
    const all = sumOf(list, "totalTokens");
    return list.map((r) => ({ ...wordsOf(r), share: all > 0 ? (r.totalTokens || 0) / all : 0, cells: { calls: count(r.requests), tokens: tokens(r.totalTokens), ...priceCells(r) } }));
  };
  const clients = rowsOf(who.clients || [], (c) =>
    c.name === WHO_OTHER
      ? { name: "Other clients", title: "The clients a day keeps no name for, as one" }
      : c.name === NO_CLIENT
        ? { name: "Unknown", title: "Calls that named no client" }
        : { name: String(c.name), title: "" },
  );
  const projects = rowsOf(who.projects || [], (p) => {
    if (p.id === WHO_OTHER) return { name: "Other projects", title: "The projects a day keeps no name for, as one" };
    if (p.id === NO_PROJECT) return { name: "No project", title: "Calls booked on no project: another tool's, or a chat that named no folder" };
    const w = projectWords(p);
    return { name: w.text, title: w.title };
  });
  const counted = sumOf(who.clients || [], "requests");
  const note = !total
    ? ""
    : !who.since
      ? `Who asked is kept by the day from this version on: none of this range's ${some(total, "call")} has it.`
      : total > counted
        ? `${count(total - counted)} of this range's ${some(total, "call")} ${total - counted === 1 ? "is" : "are"} in neither list: who asked is not kept before ${dayWords(who.since, b.today)}.`
        : "";
  return { clients, projects, note, none: !clients.length && !projects.length };
}

// ---- memory's own calls, tools ------------------------------------------------------------------------------

/**
 * Memory's own model calls over the span, by what each was for, the biggest by tokens first, and their sum in a line.
 * @param {any} total  `GET /memory/usage`'s `total` @param {Record<string, string> | null | undefined} purposes  each purpose in words
 */
export function memoryView(total, purposes) {
  if (!total?.requests) return { rows: [], line: "", none: true };
  const rows = [...groupedBy(total.rows || [], (r) => String(r.purpose || ""))]
    .map(([purpose, own]) => {
      const b = added(own);
      return { purpose, label: purposes && Object.hasOwn(purposes, purpose) ? String(purposes[purpose]) : purpose || "Memory", tokens: tokensOf(b), calls: b.requests, cells: cellsOf(b) };
    })
    .sort(biggestFirst);
  const line = `${some(total.requests, "call")} · ${tokens(tokensOf(total))} tokens · ${money(total.cost)} paid${total.listCostN ? ` · ${money(total.listCost)} at list price` : ""}`;
  return { rows, line, none: false };
}

/**
 * The tool calls counted from the runs' events: the window they come from said on their label — the runs read, where
 * they are fewer than the range's —, the tools the most used first, each with its bar's length.
 * @param {Map<string, number>} counts @param {{ runs: number, read: number }} window  the range's runs, and those read
 */
export function toolsView(counts, { runs, read }) {
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const max = sorted.length ? sorted[0][1] : 0;
  return {
    label: read < runs ? `from the newest ${some(read, "run")}` : `from this range's ${some(runs, "run")}`,
    total: some(sorted.reduce((n, [, v]) => n + v, 0), "tool call"),
    rows: sorted.map(([name, n]) => ({ name, n: count(n), pct: lengthOf(n, max) })),
    none: !sorted.length,
  };
}
