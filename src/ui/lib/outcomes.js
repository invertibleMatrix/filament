// @ts-check
// How models did, for both apps (HarnessV3-Memory M7-D53): the harness's Settings → Memory → Models and the console's
// Memory → Overview read the outcomes route (M7-D52) and say each model's record the same way. Pure: no DOM, no fetch.
import { plural } from "./claims.js";

/** The windows a reader picks: the route's `days`. */
export const OUTCOME_WINDOWS = Object.freeze([
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "Year" },
]);
/** The kinds a reader picks: every kind, or one (the route's `kind`); `noun` names what it shows. */
export const OUTCOME_FILTERS = Object.freeze([
  { value: "", label: "All", noun: "work" },
  { value: "turn", label: "Turns", noun: "turns" },
  { value: "subagent", label: "Agents", noun: "agent runs" },
  { value: "worker", label: "Team workers", noun: "team worker runs" },
]);
/**
 * The words for no outcomes: what, where, over which window. @param {{ days: string, kind: string, everywhere: boolean }} o
 */
export const noOutcomesWords = ({ days, kind, everywhere }) =>
  `No finished ${OUTCOME_FILTERS.find((f) => f.value === kind)?.noun || "work"} ${everywhere ? "anywhere" : "here"} in the last ${(OUTCOME_WINDOWS.find((w) => w.value === days)?.label || `${days} days`).toLowerCase()}. A turn's outcome is kept when it ends, an agent's or a team worker's when its run does.`;
/** A group's runs as they are named: one, many. */
const KIND = /** @type {Record<string, [string, string]>} */ (Object.freeze({ turn: ["turn", "turns"], subagent: ["agent run", "agent runs"], worker: ["team worker run", "team worker runs"] }));
/** What a run did, as its line says it, in the server's order (`DID`). */
export const DID_WORDS = /** @type {Record<string, string>} */ (Object.freeze({ tests: "Ran tests", edited: "Edited files", ran: "Ran commands", delegated: "Delegated", read: "Read only", answered: "Answered" }));
/** What the record is, and is not, for (M7-D54). */
export const OUTCOMES_NOTE = "How each model's finished work went: held is done and never corrected. A record for you to read; Filament never picks or switches a model by it.";

/**
 * The outcomes' read: the last `days`, in one workspace or every one, of one kind or all.
 * @param {{ project?: string | null, days?: string | number, kind?: string }} [o]
 */
export const outcomesPath = ({ project = null, days = 30, kind = "" } = {}) =>
  `/memory/outcomes?days=${days}${project ? `&project=${encodeURIComponent(project)}` : ""}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`;

/** A time as a reader says it. @param {number | null} ms */
export const spanWords = (ms) =>
  ms == null ? "–" : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 3_600_000).toFixed(1)} h`;
/** A cost as a reader says it: to the cent from a cent up, to the hundredth of a cent under it. @param {number | null} usd */
export const usdWords = (usd) => (usd == null ? "–" : usd === 0 ? "$0" : usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`);

/**
 * How a group's runs ended, as its bar draws them: held, done then corrected, failed, stopped — shares that add up to
 * its runs (a corrected run that failed is a failure here; its correction is in the words). Empty shares are left out.
 * @param {any} g  one of the route's `groups` (or a group's `did` line)
 * @returns {{ key: "held" | "corrected" | "failed" | "stopped", n: number, label: string }[]}
 */
export function endedParts(g) {
  /** @type {{ key: "held" | "corrected" | "failed" | "stopped", n: number, label: string }[]} */
  const parts = [
    { key: "held", n: g.held, label: "held" },
    { key: "corrected", n: g.done - g.held, label: "done, then corrected" },
    { key: "failed", n: g.failed, label: "failed" },
    { key: "stopped", n: g.stopped, label: "stopped" },
  ];
  return parts.filter((p) => p.n > 0);
}

/** What went wrong in a group (or a line), in a few words; "" when nothing did. @param {any} g */
const troubleOf = (g) => [g.corrected ? `${g.corrected} corrected` : "", g.failed ? `${g.failed} failed` : "", g.stopped ? `${g.stopped} stopped` : ""].filter(Boolean).join(" · ");

/**
 * One group's record as the panels say it: the model and its runs, held as a share and in words, what went wrong,
 * the medians, the cost a run and in all, and a line for each thing its runs did.
 * @param {any} g  one of the route's `groups`
 */
export function outcomeWords(g) {
  const [one, many] = KIND[g.kind] || [String(g.kind), String(g.kind)];
  return {
    who: String(g.model),
    kind: many,
    runs: plural(g.runs, one, many),
    held: `${Math.round((g.held / g.runs) * 100)}%`,
    heldWords: `${g.held} of ${g.runs} held`,
    trouble: troubleOf(g),
    rounds: g.rounds == null ? "–" : String(Math.round(g.rounds * 10) / 10),
    time: spanWords(g.ms),
    perRun: usdWords(g.usdPerRun),
    cost: g.usd == null ? "no price known" : `${usdWords(g.usd)} in all${g.priced < g.runs ? `, over the ${g.priced} priced` : ""}`,
    lines: (g.did || []).map((/** @type {any} */ d) => ({ did: String(d.did), what: DID_WORDS[d.did] || String(d.did), runs: d.runs, held: `${d.held} of ${d.runs} held`, trouble: troubleOf(d), parts: endedParts(d) })),
  };
}
