// @ts-check
// The teams on the side of a chat in its transcript (team_v2_plan §5.4, §5.5; TV2-D10; §10's words; §10 O3): two cards
// for each, drawn by the page and never sent to the agent, and each says so (only on your page) — where it was sent
// (who sent which team, what it was asked, its state, and its two switches while it works: Your agent gets it,
// BugHunters checks it) and where its result came (its findings counted and the first few, else the result in short;
// Send to your agent…, Verify, then send…, Ask its lead and Open beside, and where it went). Each card is the session's mark (`teamMarks`, after
// the turn it followed) drawn from the team's state as the page's list holds it now, and follows that list while it is
// drawn (lib/follow-drawn.js). A team the page knows no more (deleted with its chat) leaves its line alone. Each folds to its
// head line, as this browser keeps it, and a long ask shows three lines until Show all (the owner's ask of 10-23: "the
// cards that stick into the end of transcripts needs to be able to collapse down so that they don't cover the space").
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { toggle } from "../lib/fields.js";
import { prefs } from "../prefs.js";
import { BESIDE_BADGE, FINDING_WORDS, ONLY_YOURS, SWITCH_WORDS, cardActions, findingChips, foundByMark, missedWords, moreWords, notifiedWords, seenWords, sentTitle, stateLine } from "../lib/beside.js";
import { possessive } from "../lib/labels.js";
import { followWhileDrawn } from "../lib/follow-drawn.js";
import { inlineMarks } from "../widgets/kit.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";

/**
 * What a mark reads and does — the app's; null on a page with no teams beside (a test, a card drawn alone).
 * @type {{ row: ((id: string) => import("../lib/beside.js").BesideRow | null) | null, watch: ((fn: () => void) => () => void) | null,
 *   set: ((id: string, patch: { verify?: boolean, notify?: boolean }) => void) | null, notify: ((id: string) => void) | null,
 *   verify: ((id: string) => void) | null, open: ((id: string) => void) | null, openResult?: ((id: string) => void) | null }}
 */
export const besideActions = { row: null, watch: null, set: null, notify: null, verify: null, open: null, openResult: null };

/**
 * A team beside's mark between turns.
 * @typedef {{ type: "team", event: "fired" | "result", id: string, at: number, afterTurn: number }} TeamMark
 */

/** The folded cards this browser keeps at most: the oldest go first. */
const FOLDS_KEPT = 300;
/** The keys of the folded cards, as this browser keeps them. @returns {string[]} */
const foldedKeys = () => {
  try {
    const j = JSON.parse(String(prefs.get("foldedMarks") || "[]"));
    return Array.isArray(j) ? j.map(String) : [];
  } catch {
    return [];
  }
};
/** Fold a card, or open it again. @param {string} key @param {boolean} on */
const keepFold = (key, on) => prefs.set("foldedMarks", JSON.stringify([...foldedKeys().filter((k) => k !== key), ...(on ? [key] : [])].slice(-FOLDS_KEPT)));
/** An ask this long shows three lines until Show all. */
export const LONG_ASK = 240;

/**
 * How a card stands on this page: folded to its head line, and its long ask whole.
 * @typedef {{ folded: boolean, whole: boolean, repaint: () => void }} MarkView
 */

/**
 * A mark's card: built from the team's row, painted again as the list changes while it is in the document.
 * @param {TeamMark} m @returns {HTMLElement}
 */
export function besideMarkRow(m) {
  const body = h("div", { class: "bes-mark-body" });
  const card = h("div", { class: `tool-note bes-mark is-${m.event}`, "data-beside": m.id }, body);
  const key = `${m.event}:${m.id}`;
  /** @type {MarkView} */
  const view = { folded: foldedKeys().includes(key), whole: false, repaint: () => paint() };
  const paint = () => {
    const r = besideActions.row?.(m.id) || null;
    card.classList.toggle("is-folded", view.folded && !!r);
    const parts = m.event === "fired" ? firedParts(r, view) : resultParts(r, view);
    body.replaceChildren(...parts, ...(r ? [foldButton(view, key)] : []));
  };
  paint();
  // The list is followed while the card is drawn: the next row drawn after it has left lets it go (lib/follow-drawn.js).
  if (besideActions.watch) followWhileDrawn(card, besideActions.watch, paint);
  return card;
}

/** @param {string} name @param {string} cls */
const glyph = (name, cls) => h("span", { class: cls, "aria-hidden": "true", html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });

/** @param {string} id @param {string} [label] */
const openButton = (id, label = "Open") =>
  besideActions.open ? h("button", { class: "subagent-open", type: "button", title: "Its conversation: its lead, its workers, what it found", onclick: () => besideActions.open?.(id) }, label) : null;

/** The card's fold, at its right: it shrinks it to its head line, or opens it again. @param {MarkView} view @param {string} key */
const foldButton = (view, key) => {
  const words = view.folded ? "Show the whole card" : "Fold this card to its head line";
  return h("button", {
    class: "bes-mark-fold",
    type: "button",
    title: words,
    "aria-label": words,
    "aria-expanded": view.folded ? "false" : "true",
    html: ICONS[view.folded ? "chevronRight" : "chevronDown"],
    onclick: () => {
      view.folded = !view.folded;
      keepFold(key, view.folded);
      view.repaint();
    },
  });
};

/** The tag every team mark wears (§10 O3, the mock's D8): the page draws it, and the agent never reads it. */
const onlyYours = () => h("span", { class: "bes-only", title: "Drawn by this page from the team's chat: nothing of it is in your agent's conversation" }, glyph("eyeOff", "bes-only-ic"), ONLY_YOURS);

/**
 * How the line of where a result stands with your agent is toned: amber where its hand-on failed, green once it went
 * to your agent, quiet while your agent has not seen it. @param {import("../lib/beside.js").BesideRow} r
 */
const seenTone = (r) => (missedWords(r) ? " is-missed" : notifiedWords(r) ? " is-sent" : "");

/** A team's state as its badge. @param {import("../lib/beside.js").BesideRow} r */
const badgeOf = (r) => h("span", { class: `tg-badge is-${r.state === "working" ? "running" : r.state === "asking" ? "asking" : r.state === "done" ? "done" : "stopped"}` }, BESIDE_BADGE[r.state]);

/**
 * What it was asked: three lines of a long ask until Show all.
 * @param {string} ask @param {MarkView} view
 */
function askParts(ask, view) {
  const long = ask.length > LONG_ASK;
  const flip = () => {
    view.whole = !view.whole;
    view.repaint();
  };
  return [
    h("div", { class: `bes-mark-text${long && !view.whole ? " is-clamped" : ""}` }, h("span", { class: "bes-mark-ask", title: long ? "" : ask }, `“${ask}”`)),
    long ? h("button", { class: "br-link bes-mark-more", type: "button", "aria-expanded": view.whole ? "true" : "false", onclick: flip }, view.whole ? "Show less" : "Show all", h("span", { class: "br-link-ic", "aria-hidden": "true", html: ICONS[view.whole ? "chevronUp" : "chevronDown"] })) : null,
  ];
}

/** @param {import("../lib/beside.js").BesideRow | null} r @param {MarkView} view */
function firedParts(r, view) {
  if (!r) return [glyph("users", "bes-mark-ic"), h("span", { class: "bes-mark-text" }, "A team was sent on the side of this chat")];
  // Folded: its head line alone — who sent which team, its state, Open.
  if (view.folded) return [glyph("users", "bes-mark-ic"), h("div", { class: "bes-mark-main" }, h("div", { class: "bes-mark-head" }, h("strong", {}, sentTitle(r)), badgeOf(r), onlyYours())), openButton(r.id)];
  const acts = cardActions(r, teamsOn(state.config));
  const sw = (/** @type {"notify" | "verify"} */ k, /** @type {boolean} */ on) =>
    h("span", { class: "bes-mark-switch", title: SWITCH_WORDS[k].title }, toggle(h, on, SWITCH_WORDS[k].label, () => besideActions.set?.(r.id, { [k]: !on })), SWITCH_WORDS[k].label);
  return [
    glyph("users", "bes-mark-ic"),
    h("div", { class: "bes-mark-main" },
      h("div", { class: "bes-mark-head" }, h("strong", {}, sentTitle(r)), onlyYours()),
      ...askParts(r.ask, view),
      h("div", { class: "bes-mark-facts" }, badgeOf(r), stateLine(r) ? ` ${stateLine(r)}` : ""),
      acts.switches && besideActions.set
        ? h("div", { class: "bes-mark-switches" }, sw("notify", r.notify), r.checked ? null : sw("verify", r.verify))
        : null),
    openButton(r.id),
  ];
}

/** @param {import("../lib/beside.js").BesideRow | null} r @param {MarkView} view */
function resultParts(r, view) {
  if (!r?.result) return [glyph("check", "bes-mark-ic"), h("span", { class: "bes-mark-text" }, r ? `The ${r.team.name} team's result came in` : "A team on the side of this chat finished")];
  const acts = cardActions(r, teamsOn(state.config));
  const f = r.findings || null;
  const more = moreWords(f);
  const button = (/** @type {string} */ label, /** @type {string} */ title, /** @type {() => void} */ fn) => h("button", { class: "sub-mark-send", type: "button", title, onclick: fn }, label);
  const head = h("div", { class: "bes-mark-head" }, h("strong", {}, `${possessive(r.team.name)} result`), ...findingChips(f).map((c) => h("span", { class: `trp-chip t-${c.tone}` }, c.words)), onlyYours());
  // Folded: its head line alone — whose result, its counts, and whether your agent saw it.
  if (view.folded) return [glyph("check", "bes-mark-ic is-done"), h("div", { class: "bes-mark-main" }, head), h("span", { class: `bes-mark-sent is-folded${seenTone(r)}` }, seenWords(r, { send: false }))];
  return [
    glyph("check", "bes-mark-ic is-done"),
    h("div", { class: "bes-mark-main" },
      head,
      // Its findings ranked where its lead wrote the list (§10 O3), else its result in short.
      f
        ? h("div", { class: "bes-findings" },
            ...f.top.map((x) => {
              // Its confidence: how many Hunters found it on their own, where several did (the plan's p6).
              const by = foundByMark(x);
              return h("div", { class: "bes-finding" }, h("span", { class: `trp-dot t-${FINDING_WORDS[x.kind].tone}`, "aria-hidden": "true" }), h("span", { class: "bes-finding-t" }, ...inlineMarks(h, x.title)), by ? h("span", { class: "bes-finding-by", title: by.title }, by.text) : null, x.where ? h("code", { class: "bes-finding-w" }, x.where) : null);
            }),
            more ? h("span", { class: "bes-note" }, more) : null)
        : h("div", { class: "bes-mark-result" }, r.result.text),
      h("div", { class: "bes-mark-acts" },
        acts.notify && besideActions.notify ? button("Send to your agent…", "Its result in your message box, as an attachment: add your words, and Send sends it", () => besideActions.notify?.(r.id)) : null,
        acts.verify && besideActions.verify ? button("Verify, then send…", "Open BugHunters' Brief, filled with its result as the claims to check: Send starts it, and its check goes to your agent when it ends", () => besideActions.verify?.(r.id)) : null,
        besideActions.open ? button("Ask its lead", "Its conversation: ask its lead about what it found", () => besideActions.open?.(r.id)) : null,
        besideActions.openResult ? button("Open beside", "Its result whole, ranked, in a tile beside the chat", () => besideActions.openResult?.(r.id)) : null,
        h("span", { class: `bes-mark-sent${seenTone(r)}` }, seenWords(r, { send: acts.notify && !!besideActions.notify })))),
  ];
}
