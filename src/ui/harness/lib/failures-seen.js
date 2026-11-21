// @ts-check
// The failures the person has seen. A failed or cut-off agent of the main agent's needs you in Now until its thread was
// opened in the Agents tab, where its Retry is, since it failed (the Designer's answer of 10-26, on the owner's words:
// "show some indicator if it fails so that owner can go and retry"). Kept by this browser, as the agents' closed cards
// are (E37), by the thread and its try: a retry that fails again is a new try, and needs you again.
import { answerKey } from "./side.js";

const KEY = "harness.failuresSeen";
/** The newest marks kept; an older one's thread is long gone from Now. */
const MOST = 200;

/** @type {string[] | null} */
let marks = null;
/** @returns {string[]} */
const read = () => {
  if (marks) return marks;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    marks = Array.isArray(v) ? v.map(String) : [];
  } catch {
    marks = [];
  }
  return marks;
};

/** Whether this try's failure was seen. @param {{ id: string, exchanges: readonly unknown[] }} r */
export const failureSeen = (r) => read().includes(answerKey(/** @type {any} */ (r)));

/** Its thread was opened where its Retry is: the failure is seen. @param {{ id: string, exchanges: readonly unknown[] }} r */
export function markFailureSeen(r) {
  const k = answerKey(/** @type {any} */ (r));
  if (read().includes(k)) return;
  marks = [...read(), k].slice(-MOST);
  try {
    localStorage.setItem(KEY, JSON.stringify(marks));
  } catch {}
}
