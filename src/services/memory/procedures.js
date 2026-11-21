// @ts-check
// Procedures (HarnessV3-Memory M5-6, MD-25): how a thing is done in a project, kept as one claim — "How to <goal>: 1. …
// 2. …", each step a command or an action that worked. A procedure is known by its goal: recall offers it when a task's
// words name its goal, not for a word one of its steps happens to share; the dossier lists it under "How to"; and one
// way of doing a thing stands at a time, its slot being `how to · <goal>`. Pure: the brain files and serves them.
import { slotNorm } from "./slots.js";

/** The most characters a procedure keeps, its goal and its steps (a claim of another kind keeps 500). */
export const PROCEDURE_CHARS = 1200;
/** What a text given as a procedure that does not read as one is told. */
export const PROCEDURE_FORM = 'a procedure reads "How to <goal>: 1. <step> 2. <step>"';
/** The most steps a procedure keeps. */
const MOST_STEPS = 12;
/** The longest goal: what a task would ask for, not a paragraph. */
const GOAL_CHARS = 120;
const FENCE = /^\s*(`{3,}|~{3,})/;
// "How to <goal>: <steps>". The goal ends at the first colon that a space or the end follows, so "C:\repo" stays in it.
const HEAD = /^\s*how to\s+([^\n]+?)\s*:(?:\s+|$)([\s\S]*)$/i;
const ARTICLES = new Set(["a", "an", "the"]);

/**
 * The steps a procedure's body lists: numbered ("1. … 2. …", on one line or many, counted from 1 so a "20." inside a
 * step is not a step), else one a line (bullets and fence lines set aside), else one line split at "; " or ", then ".
 * What precedes "1." is kept as a step of its own: nothing the procedure says is lost.
 * @param {string} body @returns {string[]}
 */
export function stepsOf(body) {
  const t = String(body ?? "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const numbered = numberedSteps(t);
  const lines = t
    .split("\n")
    .filter((l) => !FENCE.test(l))
    .map((l) => l.replace(/^\s*(?:[-*•+]|\d{1,2}[.)])\s+/, ""));
  const raw = numbered.length >= 2 ? numbered : lines.filter((l) => l.trim()).length >= 2 ? lines : t.split(/\s*;\s+|,\s*(?:and\s+)?then\s+/i);
  return raw.map((s) => s.replace(/\s+/g, " ").replace(/[\s,;]+$/, "").trim()).filter(Boolean);
}
/** Numbered steps, counted from 1, with what precedes "1." first when there is any; [] with fewer than two. @param {string} t */
function numberedSteps(t) {
  /** @type {{ at: number, end: number }[]} */
  const marks = [];
  let want = 1;
  for (const m of t.matchAll(/(^|\s)(\d{1,2})[.)](?=\s)/g)) {
    if (Number(m[2]) !== want) continue;
    const at = /** @type {number} */ (m.index) + m[1].length;
    marks.push({ at, end: at + m[0].length - m[1].length });
    want++;
  }
  if (marks.length < 2) return [];
  const lead = t.slice(0, marks[0].at).replace(/[\s:]+$/, "").trim();
  return [...(lead ? [lead] : []), ...marks.map((mk, i) => t.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : t.length))];
}
/** A goal as kept: its words, without a closing "?" or "."; "" when it names nothing. @param {string} g */
const goalOf = (g) => {
  const s = String(g ?? "").replace(/\s+/g, " ").replace(/[\s?.!:]+$/, "").trim();
  return s.length >= 3 && s.length <= GOAL_CHARS && /\p{L}{2,}/u.test(s) ? s : "";
};
/** A procedure's words: "How to <goal>: 1. … 2. …", on one line, as a memory line shows it. @param {string} goal @param {string[]} steps */
const textOf = (goal, steps) => `How to ${goal}: ${steps.map((s, i) => `${i + 1}. ${s}`).join(" ")}`;

/**
 * A procedure as kept, from its goal and steps: at most `MOST_STEPS` steps within `PROCEDURE_CHARS`, the last ones
 * left out when it is longer (`cut`: how many), never a step cut in two. Null when there is no goal, fewer than `least`
 * steps, or a first step too long to keep.
 * @param {string} goal @param {string[]} steps @param {{ least?: number }} [o]
 * @returns {{ goal: string, steps: string[], text: string, cut: number } | null}
 */
export function shapeProcedure(goal, steps, { least = 1 } = {}) {
  const g = goalOf(goal);
  if (!g) return null;
  let kept = steps.slice(0, MOST_STEPS);
  while (kept.length > 1 && textOf(g, kept).length > PROCEDURE_CHARS) kept = kept.slice(0, -1);
  const text = textOf(g, kept);
  if (text.length > PROCEDURE_CHARS || kept.length < least) return null;
  return { goal: g, steps: kept, text, cut: steps.length - kept.length };
}

/**
 * A text that reads as a procedure, "How to <goal>: <steps>", as kept; null when it does not.
 * @param {string} text @param {{ least?: number }} [o]
 */
export function asProcedure(text, o) {
  const m = HEAD.exec(String(text ?? ""));
  return m ? shapeProcedure(m[1], stepsOf(m[2]), o) : null;
}

/**
 * A procedure as the dossier lists it: its goal and how many steps — the steps are left to recall, which serves them to
 * a task that names the goal, and to search. A text that does not read as one is itself.
 * @param {string} text
 */
export function procedureHead(text) {
  const p = asProcedure(text);
  return p ? `How to ${p.goal} (${p.steps.length} step${p.steps.length === 1 ? "" : "s"})` : String(text ?? "");
}

/** A procedure's goal, or null when its words do not read as one. @param {string} text */
export function goalOfProcedure(text) {
  const m = HEAD.exec(String(text ?? ""));
  return m ? goalOf(m[1]) || null : null;
}

/**
 * The slot a procedure holds (M5-6): `how to · <goal>`, the goal's words set aside case, quotes and articles, so "cut
 * a release" and "cut the release" are one goal; its value is its steps. Single-valued: one way to do a thing stands.
 * @param {{ goal: string, steps: string[] }} p @returns {{ slot: string, value: string, multi: boolean }}
 */
export function procedureSlot(p) {
  const goal = slotNorm(p.goal)
    .split(" ")
    .filter((w) => !ARTICLES.has(w))
    .join(" ");
  return { slot: `how to · ${goal}`, value: p.steps.map((s, i) => `${i + 1}. ${s}`).join(" "), multi: false };
}
