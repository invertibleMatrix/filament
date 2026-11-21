// @ts-check
// A flow's moves (the Designer's of 10-28, on the owner's "when we run flow it feels so static, no animations
// whatsoever"): motion means a machine works; stillness and orange, that it is your turn. A card is drawn anew whole
// whenever what it shows changes, so no class on it flips in place: what changed since the list's last read (lib/flow.js
// `changesOf`, kept a moment by the list) is played once on the card just drawn. A box that ends closes its bar — green
// and its tick popping once done, a line fading out once failed, stopped or skipped; a step that passes fills its rail
// down to the next number, which takes its tint with a bump while the head's digit rolls, and that step's boxes wake one
// after the other; a box that comes to ask you blooms once, its card rising in, and then nothing moves; the end rises in.
// A card drawn again in mid-moment goes on where it was: each wait less the time gone, negative once under way. Motion
// Reduced: what arrives fades in, nothing travels and nothing waits; Off: nothing. A part that goes simply goes.
import { motion } from "../bar-flight.js";

/** When each part of a hand-off starts after the box that ended it, and how long the longest of them runs (ms). */
export const FLOW_BEATS = Object.freeze({ rail: 120, arrive: 420, wake: 480, end: 400, apart: 60, longest: 700 });
/** The states of a box at work, and the one that asks you. */
const WORKS = new Set(["seat", "working", "asking"]);

/** @typedef {import("../lib/flow.js").FlowMoment} FlowMoment */

/**
 * The moments a card plays once it stands on the page; nothing where Motion is off, or it is not on the page.
 * @param {HTMLElement} card @param {readonly FlowMoment[]} moments @param {number} now
 */
export function playFlowMoves(card, moments, now) {
  const mo = motion();
  if (mo === "off" || !moments.length || !card.isConnected) return;
  const full = mo === "full";
  for (const m of moments) {
    const gone = Math.max(0, now - m.at);
    if (gone >= FLOW_BEATS.longest + FLOW_BEATS.wake) continue;
    /** A wait less the time gone — negative once under way, so a card drawn again goes on; none where motion is reduced. @param {number} ms */
    const wait = (ms) => (full ? ms - gone : 0);
    const fwd = !!m.step && m.step.to > m.step.from;
    // A box that ended: its bar closes, its pill or tick comes in.
    for (const [id, c] of Object.entries(m.boxes)) {
      const el = boxEl(card, id);
      if (!el || !WORKS.has(c.from) || WORKS.has(c.to)) continue;
      mark(el, "is-ended-now", 0, 420);
      if (full) part(el, `fl-close${c.to === "done" ? "" : c.to === "failed" ? " is-failed" : " is-quiet"}`, wait(0), 420);
    }
    // A step passed: its rail fills down to the next number, which arrives; the head's digit rolls with it.
    if (m.step) {
      const from = m.step.from >= 0 ? stepEl(card, m.step.from) : null;
      if (from && fwd) mark(from, "is-passing", wait(FLOW_BEATS.rail), 360, "--fl-rd");
      const to = stepEl(card, m.step.to);
      if (to) mark(to, "is-arrived", wait(fwd ? FLOW_BEATS.arrive : 0), 320);
      roll(card, m.step, wait(fwd ? FLOW_BEATS.arrive : 0), full);
    }
    // The boxes that start work wake one after the other — those of the step it reached after the hand-off, a box sent
    // back or retried at once; the one that asks you blooms instead.
    const base = fwd ? FLOW_BEATS.wake : 0;
    const waking = Object.entries(m.boxes).filter(([id, c]) => WORKS.has(c.to) && !WORKS.has(c.from) && id !== m.asked).map(([id]) => boxEl(card, id)).filter((x) => !!x);
    waking.forEach((el, i) => {
      el.style.setProperty("--i", String(i));
      mark(/** @type {HTMLElement} */ (el), "is-waking", wait(base), 280 + i * FLOW_BEATS.apart + 320);
    });
    // It came to ask you: one bloom where it happened, its card rising in; then nothing moves.
    if (m.asked) {
      const at = wait(fwd ? FLOW_BEATS.wake : 0);
      const el = boxEl(card, m.asked);
      if (el) mark(el, "is-asked-now", at, 700);
      for (const g of Array.from(card.querySelectorAll(".fl-gate, .fl-callout"))) mark(/** @type {HTMLElement} */ (g), "is-new-now", at, 240);
    }
    // It ended: the end's line rises in after the last box closed, the head's figure fades to its end.
    if (m.ended) {
      for (const e of Array.from(card.querySelectorAll(".fl-end"))) mark(/** @type {HTMLElement} */ (e), "is-new-now", wait(FLOW_BEATS.end), 240);
      const fig = card.querySelector(".fl-fig");
      if (fig) mark(/** @type {HTMLElement} */ (fig), "is-said", wait(0), 160);
    }
  }
}

/** A box of the card by its id. @param {HTMLElement} card @param {string} id */
const boxEl = (card, id) => /** @type {HTMLElement | null} */ (Array.from(card.querySelectorAll("[data-box]")).find((x) => x.getAttribute("data-box") === id) || null);
/** A step of the card by its place, from 0. @param {HTMLElement} card @param {number} i */
const stepEl = (card, i) => /** @type {HTMLElement | null} */ (Array.from(card.querySelectorAll(".fl-step[data-step]")).find((x) => x.getAttribute("data-step") === String(i)) || null);

/**
 * A moment's class on a part, its wait in `--fl-d` (or the variable named), taken off once it played: a part put back on
 * the page later must not play it again.
 * @param {HTMLElement} el @param {string} cls @param {number} wait @param {number} runs @param {string} [prop]
 */
function mark(el, cls, wait, runs, prop = "--fl-d") {
  el.style.setProperty(prop, `${Math.round(wait)}ms`);
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), Math.max(0, wait) + runs + 80);
}

/** A part of the moment's own, laid on a box and gone once it played. @param {HTMLElement} el @param {string} cls @param {number} wait @param {number} runs */
function part(el, cls, wait, runs) {
  const p = document.createElement("span");
  p.className = cls;
  p.setAttribute("aria-hidden", "true");
  p.style.setProperty("--fl-d", `${Math.round(wait)}ms`);
  el.append(p);
  setTimeout(() => p.remove(), Math.max(0, wait) + runs + 80);
}

/**
 * The head's step digit rolls: the old one up and out, the new one in from below — down where it went back. Reduced,
 * the new one fades in alone.
 * @param {HTMLElement} card @param {{ from: number, to: number }} step @param {number} wait @param {boolean} full
 */
function roll(card, step, wait, full) {
  const n = /** @type {HTMLElement | null} */ (card.querySelector(".fl-fig-n"));
  if (!n) return;
  n.style.setProperty("--fl-dir", step.to >= step.from ? "1" : "-1");
  // The new digit rolls in on a part of its own, beside the old one rolling out: the old one inside the moving digit
  // had their moves added up, and the new one's fade-in hid it (the Hunter's of 10-28).
  const now = document.createElement("span");
  now.className = "fl-fig-now";
  now.textContent = n.textContent;
  n.replaceChildren(now);
  mark(now, "is-rolled", wait, 220);
  if (!full || step.from < 0) return;
  const was = document.createElement("span");
  was.className = "fl-fig-was";
  was.setAttribute("aria-hidden", "true");
  was.textContent = String(step.from + 1);
  was.style.setProperty("--fl-d", `${Math.round(wait)}ms`);
  was.style.setProperty("--fl-dir", step.to >= step.from ? "1" : "-1");
  n.append(was);
  setTimeout(() => was.remove(), Math.max(0, wait) + 300);
}
