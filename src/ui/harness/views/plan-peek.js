// @ts-check
// The plan's peek (the owner's of 11-04: "if users close the side bar and when a task just got completed then briefly
// open the task graph on right bar, focus it, task is marked completed so user get a feedback and then close the bar
// again"): where the Plan is in sight nowhere — not on its tab, not beside the chat — a task of the graph done slides a
// card in at the conversation's right edge, where the right bar opens, holding the Plan's page as it stands beside the
// chat (plan.js, `pane`), the task just done marked and brought into sight; a moment later it slides out. A chat's first
// graph that found no room for the right bar shows in it too. It lies over the chat and moves nothing: a real open and
// close of the right bar would reflow the conversation, take the keyboard's place and leave a tab closed lately. It
// stands beside the floating right bar where that is open, and under the find bar where that is open over its place.
// The pointer on it holds it; Keep open puts the Plan beside the chat; × closes it. It never takes the focus, and its title is said to a screen reader. Not while
// the page is hidden: nobody would see it.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";

/** How long the peek stays, ms. */
export const PEEK_MS = 4500;
/** How long it stays once the pointer leaves it, ms. */
const LEAVE_MS = 1500;
/** Its slide out, ms: views.css's `.plan-peek`. */
const OUT_MS = 280;
/**
 * How long after its card is on the page its title is said, ms: a screen reader tells what a live region's words become,
 * not the words it was put on the page with.
 */
const SAY_MS = 60;
/** Its room under the find bar, where that is open, px. */
const UNDER_FIND = 8;

/**
 * What the peek's head says: the task just done, or the tasks; with none, the graph just made — and how much of it is
 * done, as its head counts it.
 * @param {string[]} ids @param {import("../lib/plan-watch.js").PlanFacts} facts
 * @returns {{ title: string, sub: string }}
 */
export function peekWords(ids, facts) {
  const names = ids.map((id) => facts.items.find((i) => i.key === id)?.name || id);
  const title = names.length === 1
    ? `Done: ${names[0]}`
    : names.length
      ? `${names.length} done: ${names.join(", ")}`
      : `A task graph of ${facts.all} ${facts.all === 1 ? "task" : "tasks"}`;
  return { title, sub: `Task graph · ${facts.done} of ${facts.all} done` };
}

/**
 * @param {{ frame: any, draw: (body: any, chat: any) => { paint: () => void, celebrate: (ids: string[]) => void, handOver?: () => void },
 *   keep: () => void, mk?: typeof h, later?: (fn: () => void, ms: number) => void, hidden?: () => boolean }} o
 *   `frame` the conversation's frame it lies in; `draw` draws the Plan's page into its body; `keep` puts the Plan beside
 *   the chat; `mk`, `later` and `hidden` are the tests' seams
 */
export function createPlanPeek(o) {
  const mk = o.mk || h;
  const later = o.later || ((fn, ms) => { setTimeout(fn, ms); });
  const hidden = o.hidden || (() => globalThis.document?.visibilityState === "hidden");
  /**
   * The peek on screen: its chat, its card, its head and the words it says, the page in it, whether the pointer is on
   * it, and its newest timer's number.
   * @type {{ chat: any, el: any, title: any, sub: any, words: { title: string, sub: string }, view: { paint: () => void, celebrate: (ids: string[]) => void, handOver?: () => void }, over: boolean, timer: number } | null}
   */
  let on = null;
  let timers = 0;

  /** Gone at once: the chat moved, the Plan came into sight, Keep open. */
  const closeNow = () => {
    on?.el.remove();
    on = null;
  };
  /** Slid out, then gone. */
  const close = () => {
    const was = on;
    if (!was) return;
    on = null;
    was.el.classList.remove("is-open");
    later(() => was.el.remove(), OUT_MS);
  };
  /** It goes after `ms` — unless the pointer is on it then, or a newer timer took its place. @param {number} ms */
  const arm = (ms) => {
    if (!on) return;
    const mine = ++timers;
    on.timer = mine;
    later(() => {
      if (on && on.timer === mine && !on.over) close();
    }, ms);
  };

  /**
   * Under the find bar where that is open over the peek's place, else where views.css puts it: the peek never covers a
   * search. Beside the floating right bar the two stand apart. Placed as it shows and at each pulse, so a find bar opened
   * or closed since moves it. @param {any} el
   */
  const place = (el) => {
    const find = o.frame.querySelector?.(".find-bar:not(.hidden)");
    const across = (/** @type {any} */ n) => [Number(n.offsetLeft) || 0, (Number(n.offsetLeft) || 0) + (Number(n.offsetWidth) || 0)];
    let top = "";
    if (find) {
      const [a, b] = across(el);
      const [c, d] = across(find);
      if (a < d && c < b) top = `${(Number(find.offsetTop) || 0) + (Number(find.offsetHeight) || 0) + UNDER_FIND}px`;
    }
    if ((el.style.top || "") !== top) el.style.top = top;
  };

  /** @param {any} chat */
  const build = (chat) => {
    const title = mk("div", { class: "pk-title", role: "status" });
    const sub = mk("div", { class: "pk-sub" });
    const body = mk("div", { class: "pk-body" });
    const el = mk("aside", { class: "plan-peek", "aria-label": "The plan, a moment" },
      mk("div", { class: "pk-head" },
        mk("span", { class: "pk-ic", "aria-hidden": "true", html: ICONS.circleCheck }),
        mk("div", { class: "pk-ht" }, title, sub),
        // Kept open, the Plan beside the chat shows what the peek showed: its pick, none if none was made in it.
        mk("button", { class: "tg-act pk-keep", type: "button", title: "Keep the plan open beside the chat", onclick: () => { peek.view.handOver?.(); closeNow(); o.keep(); } },
          mk("span", { class: "tg-act-ic", "aria-hidden": "true", html: ICONS.panelRight }), "Keep open"),
        mk("button", { class: "tg-ib pk-x", type: "button", title: "Close", "aria-label": "Close", html: ICONS.x, onclick: () => close() })),
      body);
    o.frame.append(el);
    place(el);
    const peek ={ chat, el, title, sub, words: { title: "", sub: "" }, view: o.draw(body, chat), over: false, timer: 0 };
    el.addEventListener("pointerenter", () => { peek.over = true; });
    el.addEventListener("pointerleave", () => {
      peek.over = false;
      if (on === peek) arm(LEAVE_MS);
    });
    // Laid out first, then slid in: its start is where the transition starts from.
    void el.offsetWidth;
    el.classList.add("is-open");
    on = peek;
  };

  return {
    /**
     * Shown for a chat, or told more while it shows: the tasks just done marked and the newest brought into sight; none,
     * the graph just made.
     * @param {any} chat @param {string[]} ids @param {import("../lib/plan-watch.js").PlanFacts} facts
     */
    show(chat, ids, facts) {
      if (hidden()) return;
      if (on && on.chat !== chat) closeNow();
      const fresh = !on;
      if (fresh) build(chat);
      const peek = /** @type {NonNullable<typeof on>} */ (on);
      if (!fresh) place(peek.el);
      peek.words = peekWords(ids, facts);
      // Its newest words, whenever they are said.
      const say = () => {
        peek.title.replaceChildren(peek.words.title);
        peek.sub.replaceChildren(peek.words.sub);
      };
      if (fresh) later(say, SAY_MS);
      else say();
      peek.view.celebrate(ids);
      arm(PEEK_MS);
    },
    /** The run moved: the page in it drawn again, as beside the chat, and placed again. */
    refresh: () => {
      if (!on) return;
      place(on.el);
      on.view.paint();
    },
    /** Gone at once: the chat moved, or the Plan came into sight. */
    close: closeNow,
    /** Whether it shows. */
    shows: () => !!on,
  };
}
