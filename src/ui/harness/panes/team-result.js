// @ts-check
// A team's result beside the chat (team_v2_plan §10 O3, the mock of 10-19): Open beside on its card or its mark opens
// it in a tile of its own. Its head — the lead's portrait, the team, when it ended, its workers — then its findings as
// its lead ranked them: the found ones (or a check's confirmed ones) as cards, each with where it is (a press opens
// the file beside) and how it shows; the unsure ones and what was not covered folded under their own lines; the
// whole result as its lead wrote it, under them. The foot: Send to your agent…, Verify, then send…, Ask its lead, and where it
// stands with your agent. Read once from the result route; its row (the Teams tab's) keeps the foot current, drawn in
// place (dom.js `morphChildren`): its buttons stand as the list beside is read again.
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { mdChat } from "../lib/md-stream.js";
import { leadLook } from "../lib/brief.js";
import { FINDING_WORDS, cardActions, findingChips, missedWords, seenWords } from "../lib/beside.js";
import { ago, inlineMarks, kids } from "../widgets/kit.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";

/**
 * @typedef {{
 *   load: () => Promise<import("../lib/beside.js").TeamResult>,
 *   row: () => import("../lib/beside.js").BesideRow | null,
 *   watch: (fn: () => void) => () => void,
 *   send: () => void,
 *   verify: () => void,
 *   ask: () => void,
 *   openFile?: (where: string) => void,
 *   now?: () => number,
 * }} ResultPaneIO  `send`: Send to your agent… (the box filled); `verify`: BugHunters' Brief; `ask`: its conversation;
 *   `openFile`: a finding's place, opened beside
 */

/** @param {string} name @param {string} [cls] */
const glyph = (name, cls = "inst-ic") => h("span", { class: cls, "aria-hidden": "true", html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });

/**
 * Draw a team's result into a tile's body. → what it follows, let go.
 * @param {HTMLElement} body @param {ResultPaneIO} io
 */
export function renderResultPane(body, io) {
  const now = io.now || Date.now;
  const foot = h("div", { class: "trp-foot" });
  const scroll = h("div", { class: "trp-scroll" }, h("p", { class: "trp-wait" }, "Reading its result…"));
  const head = h("div", { class: "trp-head" });
  const root = h("div", { class: "trp" }, head, scroll, foot);
  body.replaceChildren(root);
  /** @type {import("../lib/beside.js").TeamResult | null} */
  let res = null;

  // The foot drawn in place, each part keyed by what it is: the list beside is read again on every event of the feed
  // and every 15 s while a team works, and a foot made anew each time put its buttons under a resting pointer as new
  // elements (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost). A button the row no longer
  // offers goes alone, the others standing.
  const paintFoot = () => {
    const r = io.row();
    const acts = r ? cardActions(r, teamsOn(state.config)) : null;
    morphChildren(foot, kids([
      acts?.notify ? h("button", { class: "inst-btn is-primary", "data-key": "send", type: "button", title: "Its result in your message box, as an attachment: add your words, and Send sends it", onclick: () => io.send() }, glyph("cornerDownLeft"), "Send to your agent…") : null,
      acts?.verify ? h("button", { class: "inst-btn", "data-key": "verify", type: "button", title: "Open BugHunters' Brief, filled with its result as the claims to check: Send starts it, and its check goes to your agent when it ends", onclick: () => io.verify() }, glyph("shieldCheck"), "Verify, then send…") : null,
      h("button", { class: "inst-btn", "data-key": "ask", type: "button", title: "Its conversation: ask its lead about what it found", onclick: () => io.ask() }, glyph("messageSquare"), "Ask its lead"),
      h("span", { class: "th-sp", "data-key": "sp" }),
      r ? h("span", { class: `trp-seen${missedWords(r) ? " is-missed" : ""}`, "data-key": "seen" }, seenWords(r)) : null,
    ]));
  };

  /**
   * A finding: its title and its note are its lead's words, their code drawn as code and the rest text.
   * @param {import("../lib/beside.js").Finding} f @param {boolean} big
   */
  const findingEl = (f, big) =>
    h("div", { class: `trp-f${big ? " is-big" : ""}` },
      h("div", { class: "trp-f-top" }, h("span", { class: `trp-dot t-${FINDING_WORDS[f.kind].tone}`, "aria-hidden": "true" }), h("b", {}, ...inlineMarks(h, f.title))),
      f.where || f.note
        ? h("div", { class: "trp-f-where" },
            f.where && io.openFile ? h("button", { class: "trp-file", type: "button", title: `Open ${f.where} beside`, onclick: () => io.openFile?.(f.where) }, f.where) : f.where ? h("code", {}, f.where) : null,
            f.note ? h("span", { class: "trp-f-note" }, ...inlineMarks(h, f.note)) : null)
        : null);

  /** A folded group: its kind's line, its findings under it. @param {string} words @param {import("../lib/beside.js").Finding[]} list */
  const group = (words, list) => {
    if (!list.length) return null;
    const box = h("div", { class: "trp-group-list hidden" }, ...list.map((f) => findingEl(f, false)));
    const btn = h("button", { class: "trp-group", type: "button", "aria-expanded": "false", onclick: () => {
      const open = box.classList.toggle("hidden") === false;
      btn.setAttribute("aria-expanded", String(open));
    } }, h("span", { class: `trp-dot t-${FINDING_WORDS[list[0].kind].tone}`, "aria-hidden": "true" }), words, glyph("chevronDown", "trp-chev"));
    return h("div", {}, btn, box);
  };

  const paint = () => {
    if (!res) return;
    const r = io.row();
    const look = leadLook(res.team.key);
    head.replaceChildren(
      h("span", { class: `pf s28 t-${look.tone}`, "aria-hidden": "true" }, glyph(look.icon, "pf-ic"), glyph("crown", "pf-crown")),
      h("b", {}, `${res.team.name} · result`),
      h("span", { class: "trp-when" }, [res.at ? `done ${ago(res.at, now())}` : "", r?.workers.total ? `${r.workers.total} ${r.workers.total === 1 ? "worker" : "workers"}` : ""].filter(Boolean).join(" · ")),
    );
    const f = res.findings;
    const items = f?.items || [];
    const lead = items.filter((x) => x.kind === "found" || x.kind === "confirmed");
    const md = h("div", { class: "trp-md md", html: mdChat(res.text, null).out });
    const whole = h("details", { class: "trp-whole", ...(f ? {} : { open: "" }) }, h("summary", {}, "The whole result, as its lead wrote it"), md);
    scroll.replaceChildren(...kids([
      f ? h("div", { class: "trp-chips" }, ...findingChips(f).map((c) => h("span", { class: `trp-chip t-${c.tone}` }, c.words)), h("span", { class: "th-sp" }), h("span", { class: "trp-ranked" }, "ranked by its lead")) : null,
      ...lead.map((x) => findingEl(x, true)),
      f ? group(`Unsure · ${f.counts.plausible}`, items.filter((x) => x.kind === "plausible")) : null,
      // Each kind under its own head, with its own count (found by the Bug Hunter, 10-19: Dismissed fell under Not covered).
      f ? group(`Not covered · ${f.counts.uncovered}`, items.filter((x) => x.kind === "uncovered")) : null,
      f ? group(`Dismissed · ${f.counts.dismissed}`, items.filter((x) => x.kind === "dismissed")) : null,
      whole,
    ]));
    paintFoot();
  };

  let gone = false;
  let reading = false;
  // Read until it is read, one read at a time: a tab the page opens again at its start is drawn before the chat is
  // known, and that read fails; the next time the teams beside are read (`watch`), it is asked for again.
  const read = () => {
    if (res || reading || gone) return;
    reading = true;
    io.load().then((x) => {
      reading = false;
      if (gone) return;
      res = x;
      paint();
    }).catch((e) => {
      reading = false;
      if (gone) return;
      scroll.replaceChildren(h("p", { class: "trp-wait" }, `Its result could not be read: ${String(e?.message || e)}`));
    });
  };
  read();
  const unwatch = io.watch(() => {
    read();
    paintFoot();
  });
  paintFoot();
  return () => {
    gone = true;
    unwatch();
  };
}
