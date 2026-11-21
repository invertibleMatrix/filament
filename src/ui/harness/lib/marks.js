// @ts-check
// A state's one mark (the owner's redesign of 10-23, HarnessV4_PlanGraph): the shapes the task graph, a flow and your
// agent's work draw a box's state with — a tick for done, a turning arc while work goes on, a dot and a bar where it
// asks you, a cross where it failed, a ring for what is still to start, struck for a dropped
// one, two bars for the agent's own task while its turn has ended (paused). 16 px, shapes and class names only: the views' sheets colour them by state (views.css `.tg-mark`).

const RING = '<circle cx="8" cy="8" r="6" class="tg-m-ring"/>';
const SPIN = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" class="tg-m-track"/><path d="M8 2a6 6 0 0 1 6 6" class="tg-m-arc"/></svg>';

/** Each state's mark, by the task graph's states. */
export const MARKS = Object.freeze({
  done: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" class="tg-m-fill"/><path d="M4.8 8.3l2.1 2.1 4.3-4.6" class="tg-m-line"/></svg>',
  running: SPIN,
  checking: SPIN,
  review: SPIN,
  merging: SPIN,
  // The developer's side run (10-28): its launch on its way turns as work does; its change waiting for their Apply asks.
  starting: SPIN,
  asking: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" class="tg-m-fill"/><path d="M8 4.3v4.4" class="tg-m-line"/><circle cx="8" cy="11.4" r="1.1" class="tg-m-dot"/></svg>',
  yours: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" class="tg-m-fill"/><path d="M8 4.3v4.4" class="tg-m-line"/><circle cx="8" cy="11.4" r="1.1" class="tg-m-dot"/></svg>',
  failed: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" class="tg-m-fill"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" class="tg-m-line"/></svg>',
  ready: `<svg viewBox="0 0 16 16">${RING}</svg>`,
  waiting: `<svg viewBox="0 0 16 16">${RING}</svg>`,
  dropped: `<svg viewBox="0 0 16 16">${RING}<path d="M4.2 11.8l7.6-7.6" class="tg-m-line"/></svg>`,
  paused: `<svg viewBox="0 0 16 16">${RING}<path d="M6.6 5.7v4.6M9.4 5.7v4.6" class="tg-m-line"/></svg>`,
});

/**
 * A finished box's quiet tick, in place of a "Done" word on every box: the state said to a screen reader, and on
 * hover. @param {typeof import("../../lib/dom.js").h} mk @param {string} [title]
 */
export const doneMark = (mk, title = "Done") => mk("span", { class: "tg-mark is-done", role: "img", "aria-label": title, title, html: MARKS.done });
