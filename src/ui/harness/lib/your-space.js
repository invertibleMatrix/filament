// @ts-check
// Your Space's arithmetic (HarnessV4_Space_Plan S5b, the mock's screen 2): Today's Needs you — the chats' asks as Now
// has them and the drafts (S5c), then what fails, then the news — what a dashboard's watch brought, what a watcher told
// you —, every project's in one list —, its filters as counts, the head's line, the left bar's count, and At a glance's
// lines in the words each dashboard's tab says them. DOM-free.
import { formatValue, numberOf } from "../../artifacts/charts.js";
import { WORDS } from "./words.js";

/**
 * @typedef {import("./now.js").NowRow} NowRow
 * @typedef {import("./space-view.js").NeedRow & { project: string }} Need  a row Filament keeps, with its project
 * @typedef {"chats" | "drafts" | "failing" | "news"} Filter
 * @typedef {{ kind: "chat", filter: Filter, at: number, row: NowRow } | { kind: "kept", filter: Filter, at: number, need: Need }} TodayRow
 *   a row of Today's Needs you: a chat's, as Now has it, or one Filament keeps for a project's dashboards
 * @typedef {{ title: string, value: unknown, format: string, words: string, tone: "bad" | "good" | "", at: number | null }} StatusLine
 * @typedef {{ title: string, from: string, line: StatusLine | null, read: boolean, at: number, stale: boolean, error: string | null, held?: true }} GlanceTile
 *   `held`: a script its source runs waits for your Keep — what it read before is stale until then
 */

/**
 * The filters, in their order, and their words (A5: each row in one). The last is News, what came by itself and waits
 * for no press: a dashboard's watch is no watcher, and a filter named for one reads as the other's beside the Watchers
 * tab.
 */
export const FILTERS = Object.freeze(/** @type {const} */ (["all", "chats", "drafts", "failing", "news"]));
export const FILTER_WORDS = Object.freeze({ all: "All", chats: WORDS.chats, drafts: "Drafts", failing: "Failing", news: "News" });

/**
 * Each kind of row Filament keeps, by its filter: a check that says a button did not work fails too (S5d), as a
 * routine's failed run does (S6) and what an agent found reproducing a report (S7) — the group a project's Space ranks
 * them in. A chat's ask for a press is a chat asking you (E42 SA-D7, the Designer): Chats, ranked before Drafts. Every
 * kind named, so a new one is placed here, not left to News (found by the Hunter on S6). Another machine's row
 * (sp-cross) goes by the kind it is there (`keptFilter`).
 * @type {Record<Need["kind"], Filter>}
 */
const KEPT_FILTER = { ask: "chats", draft: "drafts", source: "failing", check: "failing", routine: "failing", repro: "failing", watch: "news", machine: "news" };
/**
 * A kept row's filter: another machine's by the kind it is there. A routine's row by what it is: a guidance held for
 * your Send it waits for your press as a draft's Review & send does, and so does a watcher Filament switched off, for
 * your Switch on; what a watcher told you is news as a watch's find is, and only a failed run fails.
 * @param {Need} need
 */
const keptFilter = (need) =>
  need.kind === "routine" && (need.routine?.guide || need.routine?.unapproved) ? "drafts"
  : need.kind === "routine" && need.routine?.told ? "news"
  : ((need.kind === "machine" ? KEPT_FILTER[/** @type {Need["kind"]} */ (need.machine?.was)] : KEPT_FILTER[need.kind]) ?? "news");

/**
 * Today's rows (case 3, A5): what asks you first — the chats that ask, then the drafts that wait for your Send (S5c),
 * a watcher's held guidance among them —, then what fails — a chat stopped on an error, a source that stopped —, then
 * the news: what the watches brought and what a watcher told you; the newest first in each.
 * @param {readonly NowRow[]} asks  Now's Needs you rows @param {readonly Need[]} open  the open rows Filament keeps
 * @returns {TodayRow[]}
 */
export function todayRows(asks, open) {
  /** @type {TodayRow[]} */
  const rows = [
    ...asks.map((row) => /** @type {TodayRow} */ ({ kind: "chat", filter: row.tone === "error" ? "failing" : "chats", at: row.at, row })),
    ...open.map((need) => /** @type {TodayRow} */ ({ kind: "kept", filter: keptFilter(need), at: need.at, need })),
  ];
  const rank = { chats: 0, drafts: 1, failing: 2, news: 3 };
  // In Chats, the chats' live asks first — they hold a running turn —, then the asks Filament keeps (E42 SA-D7).
  const live = (/** @type {TodayRow} */ r) => (r.filter === "chats" && r.kind !== "chat" ? 1 : 0);
  return rows.sort((a, b) => rank[a.filter] - rank[b.filter] || live(a) - live(b) || b.at - a.at);
}

/** How many rows each filter holds, All first. @param {readonly TodayRow[]} rows @returns {Record<(typeof FILTERS)[number], number>} */
export function filterCounts(rows) {
  const n = { all: rows.length, chats: 0, drafts: 0, failing: 0, news: 0 };
  for (const r of rows) n[r.filter]++;
  return n;
}

/** "6 need you", "1 needs you"; "" for none. @param {number} n */
export const needYouWords = (n) => (n ? `${n} need${n === 1 ? "s" : ""} you` : "");

/**
 * The head's line (case 2): the day, how many need you, how many work, and what runs next by itself — "Sunday 25 October ·
 * 6 need you · 2 working · next by itself: Morning brief at 09:00".
 * @param {number} now @param {number} needs @param {number} works @param {{ title: string, at: number } | null} [next]
 */
export function headWords(now, needs, works, next = null) {
  const day = new Date(now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return [day, needYouWords(needs), works ? `${works} working` : "", next ? `next by itself: ${next.title} at ${nextWhen(next.at, now)}` : ""].filter(Boolean).join(" · ");
}

/** A time to come as the head says it: "14:30" today, "Tue 09:00" past it. @param {number} at @param {number} now */
function nextWhen(at, now) {
  const d = new Date(at);
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date(now).toDateString() ? clock : `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${clock}`;
}

/**
 * What runs by itself next, of every Space's routines on and watches (the mock's screen 2: "next by itself: Messages check
 * at 14:30"); none while Pause all is on, or nothing has a next time.
 * @param {{ pausedSince?: number | null, routines?: { title: string, state: string, paused: boolean, words?: { nextAt?: number | null } }[],
 *   watches?: { title: string, paused?: boolean, nextAt?: number | null }[] } | null | undefined} runs
 * @returns {{ title: string, at: number } | null}
 */
export function nextByItself(runs) {
  if (!runs || runs.pausedSince) return null;
  const all = [
    ...(runs.routines || []).filter((r) => r.state === "on" && !r.paused && r.words?.nextAt).map((r) => ({ title: r.title, at: Number(r.words?.nextAt) })),
    ...(runs.watches || []).filter((w) => !w.paused && w.nextAt).map((w) => ({ title: `a watch of ${w.title}`, at: Number(w.nextAt) })),
  ];
  return all.sort((a, b) => a.at - b.at)[0] || null;
}

/** The left bar's count (case 1): the chats' that need you and every project's open rows. @param {number} asks @param {Record<string, number>} counts */
export const yourCount = (asks, counts) => asks + Object.values(counts || {}).reduce((t, n) => t + (Number(n) || 0), 0);

/**
 * A status tile's value in its tab's words (ui/artifacts/dashboard.js `statusOf`): "—" for none; a number in its
 * format; a day, a moment or words as written.
 * @param {StatusLine} line
 */
export function shownValue(line) {
  const v = line.value;
  if (v == null || v === "") return "—";
  const f = line.format;
  return f !== "text" && f !== "date" && f !== "time" && numberOf(v) != null ? formatValue(v, f) : String(v);
}

/** How long ago a moment was, as a tab says it: "just now", "12 min ago", "3 h ago", "Oct 22". @param {number} at @param {number} now */
export function agoWords(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** When rows a failed read left were read: "14:05" today, else "Oct 24, 14:05". @param {number} at @param {number} now */
export function asOfWords(at, now) {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * A tile of At a glance in words (case 4): its value and tone with the words under it and its age, as its tab says
 * them; rows a failed read left, "as of" when — and that it waits for your Keep, where a script its source runs does
 * (`held`) —; else why it shows none — it waits for your Keep, it could not be read, it has no row, or it is being read.
 * @param {GlanceTile} t @param {number} now
 * @returns {{ value: string, tone: "bad" | "good" | "", under: string, faint: string }}
 */
export function glanceWords(t, now) {
  if (t.line) {
    const under = [t.line.words, t.line.at != null ? agoWords(t.line.at, now) : ""].filter(Boolean).join(" · ");
    return { value: shownValue(t.line), tone: t.line.tone, under, faint: t.stale ? `as of ${asOfWords(t.at, now)}${t.held ? " · waits for your Keep" : ""}` : "" };
  }
  if (t.held) return { value: "", tone: "", under: "Waits for your Keep in its Space.", faint: "" };
  if (t.error) return { value: "", tone: "bad", under: `Couldn't read ${t.from}: ${String(t.error).replace(/\.$/, "")}.`, faint: "" };
  return { value: "", tone: "", under: t.read ? "No rows yet." : "Reading…", faint: "" };
}
