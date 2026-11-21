// @ts-check
// What happened (proposal_ux §4.14; HarnessV4_Space_Plan S1, SG-D4): the Space's logbook, filling itself — Filament's
// own lines on what each chat finished and what the lanes did, what the project's chats wrote with their space tool,
// the times the person told the chats, the Record keeper's line for each week, and the person's notes. The newest
// first, each with when, the line, and where it came from at its right — a lane's chip where there are two, and a word
// for a note, a telling, the week and another machine; a chat's line and Filament's own, the most of them, say none.
// The lines are short: Filament's own cut to one line, every other to two (space.css, by the entry's class); a press on
// a line's words — Enter and Space too — opens it whole, a second closes it, and its tip keeps the whole text. The
// newest twelve stand, then Show all N — all of them for as long as the page is open, or until Show the newest 12 —,
// in the page's own scroller. Where you left off above them, when the chats moved since your last look (left-off.js,
// the page's own until the reshape of 10-29). Its head: how many came today, Add a note… (Enter writes it, Shift+Enter
// breaks the line, Escape lets it go) and ⋯ — Tell the chats… (the card a sync was, opened under the head; nothing is
// sent until its own press), one lane's lines alone, or all; Copy this week as Markdown. On a project with no Space yet
// a note, and Tell them, make it, and their tips say so (by need, 11-12).
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS, icon } from "../lib/icons.js";
import { menu } from "../lib/ui.js";
import { happenedTag, whenWords } from "../lib/space-view.js";

/** How many lines stand before Show all N. */
const SHOWN = 12;

/**
 * What the panel reads and does. `lanes`: the Space's lanes; `nameOf`: a chat by its name; `laneOf`: the lane a chat
 * works in; `write`: the person's note written, the Space's answer or null; `copyWeek`: the week's page copied;
 * `tell`: Tell the chats… pressed; `left`: Where you left off (left-off.js), first under the head since the reshape of
 * 10-29; `card`: the Tell the chats card, under the head whose ⋯ opens it; `openChat`: a chat opened from its line;
 * `makes`: whether the project has no Space yet, so a note or a telling makes it (by need, 11-12).
 * @typedef {{ lanes: () => import("../lib/space-view.js").LaneRef[], nameOf: (chain: string) => string,
 *   laneOf: (chain: string) => import("../lib/space-view.js").LaneRef | null, write: (text: string) => Promise<any>,
 *   copyWeek: () => void, tell: () => void, left?: HTMLElement, card?: HTMLElement, openChat?: (chain: string) => void,
 *   makes?: () => boolean, now?: () => number }} LogbookCtx
 */

/** @param {LogbookCtx} ctx */
export function logbookPanel(ctx) {
  const now = ctx.now || Date.now;
  /** The lane the list is narrowed to, by its folder; null for all. @type {string | null} */
  let only = null;
  /** @type {import("../lib/space-view.js").SpaceEntry[]} */
  let entries = [];
  let more = 0;
  let drawn = "";
  /** The lines opened whole, by their entries. @type {Set<string>} */
  const opened = new Set();
  /** Show all N pressed: every line stands, while the page is open or until Show the newest 12. */
  let showAll = false;
  const list = h("div", { class: "sl-list", role: "list", "aria-label": "What happened" });
  const today = h("span", { class: "sp-quiet sl-today" });
  const field = /** @type {HTMLTextAreaElement} */ (h("textarea", { class: "zc-input sl-field", rows: "1", maxlength: "2000", placeholder: "A note for the chats here and for you…", "aria-label": "Add a note" }));
  const said = h("span", { class: "sl-said", role: "status" });
  const write = h("div", { class: "sl-write", hidden: "" }, h("span", { class: "sl-pen", html: ICONS.pencil }), field, said);
  const moreBtn = h("button", { class: "ghost icon sl-menu", type: "button", "aria-haspopup": "menu", "aria-label": "More: tell the chats, one lane's lines, or copy this week", title: "More", html: icon("ellipsis"), onclick: () => pick() });
  const noteBtn = h("button", { class: "ghost sm sl-note", type: "button", title: "A line of your own in What happened", onclick: () => openNote() },
    h("span", { class: "sp-btn-ic", html: ICONS.pencil }), "Add a note…");
  const laneWord = h("span", { class: "sp-branch sl-only", hidden: "" });
  const el = h("section", { class: "sl-panel", "aria-label": "What happened" },
    h("div", { class: "sl-head" },
      h("h3", { class: "sp-sec-name" }, "What happened"),
      today,
      laneWord,
      h("span", { class: "sb-sp" }),
      // One group: too narrow a head moves the two to the next line together, at its right.
      h("span", { class: "sl-acts" }, noteBtn, moreBtn)),
    ...(ctx.left ? [ctx.left] : []),
    ...(ctx.card ? [ctx.card] : []),
    write,
    list);

  /** ⋯: Tell the chats…, its card opened under the head; one lane's lines or all, where there are two to pick between
   *  (the Designer, 10-29: a Space of one folder offered "All lanes"); this week's page copied. */
  function pick() {
    const lanes = ctx.lanes();
    menu([
      { label: "Tell the chats…", icon: "messageSquare", desc: `Each agent reads the board and what the others wrote, then writes what changes for it: nothing is sent until you press Tell them${ctx.makes?.() ? ", which makes this project's Space" : ""}`, onClick: () => ctx.tell() },
      { type: "separator" },
      ...(lanes.length > 1 ? [{ type: "radio", label: "All lanes", checked: only == null, onClick: () => { only = null; paint(true); } },
        ...lanes.map((l) => ({ type: "radio", label: l.chip, checked: only === l.path, onClick: () => { only = l.path; paint(true); } })),
        { type: "separator" }] : []),
      { label: "Copy this week", icon: "copy", desc: "The board and this week's lines, as Markdown", onClick: () => ctx.copyWeek() },
    ], { anchor: moreBtn, side: "bottom", align: "end", width: 280 });
  }

  function openNote() {
    write.hidden = false;
    field.focus();
  }
  const closeNote = () => {
    write.hidden = true;
    field.value = "";
    field.style.height = "";
    said.replaceChildren();
  };

  field.addEventListener("input", () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight || 0, 160)}px`;
    said.replaceChildren();
  });
  field.addEventListener("keydown", async (/** @type {KeyboardEvent} */ e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeNote();
      noteBtn.focus?.();
      return;
    }
    // An input method's Enter ends its word (Chinese, Japanese): it never writes the note (HC-117).
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const text = field.value.trim();
    if (!text) return;
    field.disabled = true;
    const ok = await ctx.write(text);
    field.disabled = false;
    if (ok) closeNote();
    else {
      said.replaceChildren("Not written");
      field.focus();
    }
  });

  /** A line opened whole, or closed to its one or two lines again. @param {string} id */
  function toggle(id) {
    if (!opened.delete(id)) opened.add(id);
    paint(true);
  }

  /**
   * A line: when, its words — the person's as theirs, an agent's after its chat's name — and where it came from. Its
   * words are a button: a press, Enter or Space opens the line whole, and closes it again; the chat's name inside them
   * opens its chat and leaves the line as it stands.
   * @param {import("../lib/space-view.js").SpaceEntry} e
   */
  function entryEl(e) {
    const tag = happenedTag(e);
    const chat = e.by.chain ? ctx.nameOf(e.by.chain) : "";
    const lane = e.by.chain ? ctx.laneOf(e.by.chain) : null;
    // A dashboard's watch writes as Filament, under the dashboard's name; another machine's line, under that machine's
    // and who wrote it there (sp-cross).
    const who = e.by.kind === "you" ? "You" : e.by.kind === "agent" ? (e.by.name ? `${e.by.name} · for ${chat || "a chat"}` : chat || "An agent") : e.by.kind === "filament" && e.by.name ? e.by.name
      : e.by.kind === "machine" ? `${e.by.name || "Another machine"}${e.by.who ? ` · ${e.by.who}` : ""}` : "";
    const words = e.by.kind === "you" ? `“${e.text}”` : e.text;
    const open = e.by.chain && ctx.openChat ? () => ctx.openChat?.(/** @type {string} */ (e.by.chain)) : null;
    const whole = opened.has(e.id);
    return h("article", { class: `sl-entry is-${tag}${whole ? " is-open" : ""}`, role: "listitem", "data-entry": e.id, "data-key": `entry:${e.id}` },
      h("span", { class: "sl-when", title: new Date(e.at).toLocaleString() }, whenWords(e.at, now())),
      h("div", {
        class: "sl-text",
        role: "button",
        tabindex: "0",
        "aria-expanded": String(whole),
        title: e.text,
        onclick: (/** @type {MouseEvent} */ ev) => {
          // The chat's name is a button of its own; and a press that ends a selection of the words is no press on them.
          if (/** @type {Element | null} */ (ev.target)?.closest?.("button.sl-who") || String(globalThis.getSelection?.() || "")) return;
          toggle(e.id);
        },
        onkeydown: (/** @type {KeyboardEvent} */ ev) => {
          // Its own keys alone: Enter on the chat's name inside is that button's. Space, taken, scrolls nothing.
          if (ev.target !== ev.currentTarget || (ev.key !== "Enter" && ev.key !== " ")) return;
          ev.preventDefault();
          toggle(e.id);
        },
      },
      ...(who ? [open ? h("button", { class: "sl-who", type: "button", title: `Open ${chat}`, onclick: open }, who) : h("b", { class: "sl-who" }, who), ": "] : []),
      words),
      // A lane's chip only where there are two to tell apart: with one, every line would say it. A chat's line and
      // Filament's own say no word here: they are the most of the lines, and a word on each would tell none apart.
      h("span", { class: "sl-tag" }, ...(lane && tag !== "note" && ctx.lanes().length > 1 ? [h("span", { class: `sp-branch${lane.main ? " is-main" : ""}` }, lane.chip)] : []), tag === "agent" || tag === "filament" ? "" : tag === "machine" ? "another machine" : tag));
  }

  /** @param {boolean} [force] */
  function paint(force = false) {
    noteBtn.setAttribute("title", `A line of your own in What happened${ctx.makes?.() ? ": it makes this project's Space" : ""}`);
    // A lane gone, or one left (no All lanes to undo it, the reviewer of 10-29): all lines again.
    const lane = only && ctx.lanes().length > 1 ? ctx.lanes().find((l) => l.path === only) || null : null;
    if (only && !lane) only = null;
    laneWord.hidden = !lane;
    laneWord.replaceChildren(lane ? lane.chip : "");
    const start = new Date(now()).setHours(0, 0, 0, 0);
    const n = entries.filter((e) => e.at >= start).length;
    today.replaceChildren(n ? `today ${n}` : "");
    // The lines there are to show — one lane's alone where the list is narrowed to it —, and those that stand: the
    // newest twelve, or all of them once Show all N is pressed.
    const lines = (lane ? entries.filter((e) => !!e.by.chain && lane.chains.includes(e.by.chain)) : entries).slice().reverse();
    const shown = showAll ? lines : lines.slice(0, SHOWN);
    const makes = !!ctx.makes?.();
    const key = JSON.stringify([only, showAll, makes, lines.length, shown.map((e) => [e.id, e.at, e.text, opened.has(e.id)]), ctx.lanes().map((l) => [l.chip, l.main, l.chains]), Math.floor(now() / 60_000)]);
    if (!force && key === drawn) return;
    drawn = key;
    // In place, each line kept by its entry: the minute moves its "when" (the owner's of 11-01: buttons blinking under
    // a resting pointer, clicks lost — a line's chat button, made anew each minute).
    morphChildren(list, [
      ...(shown.length
        ? shown.map(entryEl)
        // On a project with no Space yet nothing writes here until the person does: their note makes it (by need, 11-12).
        : [h("p", { class: "sl-empty" }, lane ? "Nothing from this lane's chats yet."
            : makes ? "Nothing yet. A note of yours makes this project's Space; from then Filament says here as the chats finish their turns, and their agents write here too."
            : "Nothing yet. As the chats here finish their turns, Filament says so here; their agents write here too, and so can you.")]),
      ...(lines.length > SHOWN
        ? [h("button", { class: "sp-quiet sl-more", type: "button", "data-key": "more", onclick: () => { showAll = !showAll; paint(true); } }, showAll ? `Show the newest ${SHOWN}` : `Show all ${lines.length}`)]
        : []),
      // The lines the Space keeps past those it sends follow the oldest it sent: said once every one of those stands.
      ...(more > 0 && !lane && shown.length === lines.length ? [h("p", { class: "sp-quiet sl-older" }, `${more} older line${more === 1 ? "" : "s"} kept; the agents can still read them.`)] : []),
    ]);
  }

  return {
    el,
    /** @param {import("../lib/space-view.js").SpaceEntry[]} next @param {number} older */
    paint(next, older) {
      entries = next;
      more = older;
      paint();
    },
    tick: () => paint(),
  };
}
