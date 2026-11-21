// @ts-check
// Watch all (proposal_ux §4.7, Phase 5): the Sub Agents tab's second way to look — every agent at work for the chat at
// once, a tile each, two across, three where the tab is wide. A tile's head is the agent's glyph, its name, who started
// it, its model at its effort, how long it has run and Stop; its body its newest work — the files it changed, the call
// it is in — and its newest words; what it asks you, with Open the ask; its foot its rounds and what its window holds,
// Open beside and Open thread. One that asks you wears an orange edge. A coding agent's own is read here and never
// stopped: its agent shares its calls and answers, not its thinking (AG-155). Nothing here starts anything (the owner's
// word of 10-18): a tile opens its thread. Each tile is kept by its agent's id and built again only when what it says
// changes; its clock moves on every paint.
import { h, morphChildren, standing } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { isGuest, rowIcon, tileWords, watchAll, whoTag } from "../lib/side.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";

/** What the grid says while no agent works. */
export const WATCH_EMPTY = "No agent is at work in this chat now. Each one shows here while it works: yours, the main agent's, a team's and its coding agent's own.";
/** The same while Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js). */
export const WATCH_EMPTY_ALONE = "No agent is at work in this chat now. Each one shows here while it works: yours, the main agent's and its coding agent's own.";
/** Under a coding agent's own: what its agent shares of it. */
const OWN_NOTE = "Its coding agent shares its calls and answers, not its thinking.";

/**
 * @param {{ open: (id: string) => void, beside?: (id: string) => void, stop?: (id: string) => void }} io
 *   `open`: its thread, in the tab; `beside`: its thread in a pane beside the chat; `stop`: one of Filament's stopped
 * @param {{ h?: typeof h, place?: (parent: any, wanted: any[]) => void, drawIn?: (parent: any, nodes: any[]) => void }} [o]
 *   the tests' fake DOM and its way into a host (`drawIn`; `place`, which the grid no longer reads, is the Agents tab's)
 * @returns {{ el: any, paint: (rows: import("../lib/subagents.js").SubagentRow[], own: import("../lib/subagents.js").GuestRow[], now: number) => number }}
 */
export function createWatchAll(io, o = {}) {
  const mk = o.h || h;
  const drawIn = o.drawIn || morphChildren;
  /** @param {string} name @param {string} cls */
  const glyph = (name, cls) => mk("span", { class: cls, html: /** @type {any} */ (ICONS)[name] || ICONS.bot });
  const grid = mk("div", { class: "sw-grid" });
  const empty = mk("p", { class: "sw-empty" }, WATCH_EMPTY);
  const el = mk("div", { class: "sw", role: "region", "aria-label": "Every agent at work" }, grid, empty);
  /** Each tile drawn, by its agent's id: what it says, and its clock. @type {Map<string, { el: any, key: string, took: any }>} */
  const tiles = new Map();

  /**
   * @param {import("../lib/subagents.js").SubagentRow | import("../lib/subagents.js").GuestRow} r
   * @param {ReturnType<typeof tileWords>} w
   */
  const make = (r, w) => {
    const id = r.id;
    const asks = !!w.ask;
    const took = mk("span", { class: "sw-took" }, w.took);
    const state = asks
      ? mk("span", { class: "sw-state is-asks" }, "waits for you · ", took)
      : mk("span", { class: "sw-state" }, mk("span", { class: "sw-spin", "aria-hidden": "true", html: ICONS.loader }), took);
    const stop = !isGuest(r) && io.stop
      ? mk("button", { class: "sw-stop", type: "button", title: "Stop it now; what it finished is kept as its report", onclick: () => io.stop?.(id) }, "Stop")
      : null;
    const head = mk("div", { class: "sw-head" },
      glyph(rowIcon(r), `sw-av${isGuest(r) ? " is-own" : ""}`),
      mk("button", { class: "sw-name", type: "button", title: "Open its thread", onclick: () => io.open(id) }, w.name),
      mk("span", { class: "sw-tag" }, whoTag(r)),
      w.model ? mk("span", { class: "sw-model" }, w.model) : null,
      mk("span", { class: "sw-sp" }),
      state,
      stop);
    const work = w.work.map((x) => mk("div", { class: "sw-work" }, mk("span", { class: "sw-work-label" }, x.label), mk(x.mono ? "code" : "span", { class: "sw-work-text" }, x.text)));
    const ask = w.ask
      ? mk("div", { class: "sw-ask", role: "group", "aria-label": `${w.name} asks you` },
        mk("p", { class: "sw-ask-q" }, mk("b", {}, w.ask.question ? w.ask.verb : `It ${w.ask.verb}`), w.ask.what ? mk("code", { title: w.ask.whole }, w.ask.what) : null),
        mk("div", { class: "sw-ask-acts" },
          mk("button", { class: "inst-btn sw-ask-open", type: "button", onclick: () => io.open(id) }, "Open the ask"),
          mk("span", { class: "sw-ask-note" }, w.ask.question ? "You answer it in its thread." : "You answer in its thread; nothing runs until you allow it.")))
      : null;
    // A press on the body reads it whole: its thread, where its work streams.
    const body = mk("div", { class: "sw-body", onclick: () => io.open(id) },
      ...work,
      w.words ? mk("p", { class: "sw-words" }, w.words) : null,
      ask,
      w.own ? mk("p", { class: "sw-note" }, OWN_NOTE) : null);
    const foot = mk("div", { class: "sw-foot" },
      mk("span", { class: "sw-figs", ...(w.tip ? { title: w.tip } : {}) }, w.figures),
      mk("span", { class: "sw-sp" }),
      io.beside ? mk("button", { class: "inst-link sw-beside", type: "button", title: "Its thread in a pane beside the chat", onclick: () => io.beside?.(id) }, "Open beside") : null,
      mk("button", { class: "inst-link sw-open", type: "button", onclick: () => io.open(id) }, "Open thread", mk("span", { class: "sd-caret", html: ICONS.chevronRight })));
    const tile = mk("section", { class: `sw-tile${asks ? " is-asks" : ""}${w.own ? " is-own" : ""}`, "data-id": id, "data-key": id, "aria-label": w.name }, head, body, foot);
    return { el: tile, took };
  };

  return {
    el,
    /**
     * Drawn again at each pulse: a tile whose words moved is drawn again over the one that stands — in place, its Stop
     * and its links under a resting pointer the elements they were (the owner's of 11-01: buttons blinking, clicks
     * lost) —, the others keep their place, their clocks moved; says how many work.
     */
    paint(rows, own, now) {
      empty.replaceChildren(teamsOn(state.config) ? WATCH_EMPTY : WATCH_EMPTY_ALONE);
      const live = watchAll(rows, own);
      const ids = new Set(live.map((r) => r.id));
      for (const id of [...tiles.keys()]) if (!ids.has(id)) tiles.delete(id);
      drawIn(grid, live.map((r) => {
        const w = tileWords(r, now);
        const key = JSON.stringify([w.name, w.model, w.ask, w.work, w.words, w.figures, w.tip, whoTag(r), rowIcon(r)]);
        let tile = tiles.get(r.id);
        if (!tile || tile.key !== key) {
          tile = { ...make(r, w), key };
          tiles.set(r.id, tile);
        } else tile.took.replaceChildren(w.took);
        return tile.el;
      }));
      // A tile drawn over the one that stood is that one from now on: its clock is the one on the page.
      for (const [id, t] of tiles) tiles.set(id, { ...t, el: standing(t.el), took: standing(t.took) });
      empty.classList.toggle("hidden", live.length > 0);
      return live.length;
    },
  };
}
