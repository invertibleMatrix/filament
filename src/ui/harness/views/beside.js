// @ts-check
// The teams on the side of this chat, on its Agents tab (team_v2_plan §5.2 to §5.4, §10 O1, O2; U13-D5): a team at work or
// asking shows as its live board (views/board.js) — its lead's frame and a frame per worker — and one that ended as a
// card: its team, what it was asked and who sent it, what it runs on, its state, its result once in, and the hand-offs,
// each a press: Send to your agent, Verify, then send… (which opens BugHunters' Brief, filled, its check handed to
// your agent when it ends), Ask its lead (its conversation), Resume… on one that stopped before it finished. Under them, the room on every model while one works. Send a team… opens the Brief
// (views/brief.js): a team starts there, never here. The words are lib/beside.js's and lib/boards.js's; every press
// goes through the host (app.js). It paints in place: a card or board is built again only when what it says changes.
// The Agents tab's pane for one team's row paints that team alone (`paint(chat, only)`): its board or its card.
import { h, morphChildren, placeChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { toggle } from "../lib/fields.js";
import { ago, inlineMarks, kids } from "../widgets/kit.js";
import { leadLook } from "../lib/brief.js";
import { possessive } from "../lib/labels.js";
import { BESIDE_BADGE, CHECKING_WORDS, FINDING_WORDS, SWITCH_WORDS, cardActions, fellWords, findingChips, firedWords, foldsToRow, foundByMark, missedWords, moreWords, notifiedWords, onWords, seenWords, stateLine } from "../lib/beside.js";
import { roomStrip } from "../lib/boards.js";
import { createBoards } from "./board.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";

/**
 * What the section reads and does — the host's.
 * @typedef {{
 *   rows: () => import("../lib/beside.js").BesideRow[],
 *   brief: (fill?: import("./brief.js").BriefFill) => void,
 *   set: (id: string, patch: { verify?: boolean, notify?: boolean }) => void,
 *   notify: (id: string) => void,
 *   verify: (id: string) => void,
 *   stop: (id: string) => void,
 *   open: (id: string) => void,
 *   openResult?: (id: string) => void,
 *   resume: (id: string) => void,
 *   main?: () => string | null,
 *   self?: () => import("../lib/beside.js").BesideRow | null,
 *   openMain?: () => void,
 *   board?: import("./board.js").BoardIO,
 *   room?: () => { rows?: any[] } | null,
 *   openSlots?: () => void,
 *   now?: () => number,
 * }} BesideIO  `brief`: the Brief opened, filled as a press asks; `notify`: its result to your agent; `verify`:
 *   BugHunters' Brief, filled with its result; `open`: the team's conversation; `openResult`: its result whole, beside the
 *   chat (§10 O3); `resume`: its conversation opened, its
 *   message box filled to go on; `main`: the chat this one runs beside, where it is a team's own — which sends no team of
 *   its own (§8) — and `openMain` opens it; `self`: that team's own row, shown as its main chat shows it; `board`: a working team's board's reads and presses (§10 O2), where the
 *   host follows them; `room`: each model's room as last read, for the room strip; `openSlots`: where each model's limit is set
 */

/**
 * @param {BesideIO} io
 * @param {{ h?: typeof h, place?: (parent: any, wanted: any[]) => void, drawIn?: (parent: any, nodes: any[]) => void }} [o]  the tests' fake DOM and its `place`
 * @returns {{ el: any, paint: (chat: any, only?: string | null) => void, has: () => boolean, isTeamChat: () => boolean }}
 */
export function createBesideView(io, o = {}) {
  const mk = o.h || h;
  const place = o.place || placeChildren;
  // Drawn again at every pulse of the chat's teams: the grid, its rows and cards, and the room strip in place — the
  // buttons under a resting pointer the elements they were (the owner's of 11-01: buttons blinking, clicks lost).
  const drawIn = o.drawIn || morphChildren;
  const now = io.now || Date.now;
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "inst-ic") => mk("span", { class: cls, html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  /** @param {string} key @param {string} size */
  const portrait = (key, size) => {
    const look = leadLook(key);
    return mk("span", { class: `pf ${size} t-${look.tone}`, "aria-hidden": "true" }, glyph(look.icon, "pf-ic"), glyph("crown", "pf-crown"));
  };

  /** @type {any} */
  let chat = null;
  /** The one team painted alone, where its row's pane shows it; null for every team. @type {string | null} */
  let only = null;

  const head = mk("h3", { class: "tv-h is-big" });
  const headFig = mk("span", { class: "tv-h-fig" });
  const line = mk("p", { class: "bes-line" }, "Teams working next to this chat: your agent keeps going, and nothing they find reaches it unless you send it.");
  const sendBtn = mk("button", { class: "inst-btn bes-run", type: "button", title: "Open the Brief: pick a team and the way, say what it is to do — Send starts it", onclick: () => io.brief() }, glyph("plus"), "Send a team…");
  const grid = mk("div", { class: "bes-grid" });
  const boards = io.board ? createBoards({ ...io.board, now }, { h: mk, place, drawIn }) : null;
  const roomEl = mk("div", { class: "bes-room" });
  const el = mk("section", { class: "tv-section bes", "aria-label": "Teams on the side of this chat" });
  // Its head, made once: Send a team… stays itself under the pointer, never moved into a head made anew.
  const headBox = mk("div", { class: "bes-head" }, glyph("columns2", "th-way-tile t-blue"), mk("div", { class: "bes-head-text" }, head, line), sendBtn);
  // A team's own chat shows in boxes of its own, made once: drawn in place into the main chat's, the head took the grid's
  // look and lost Send a team… (the developer's reviewer of 11-02).
  const ofHead = mk("div", { class: "bes-head" }, glyph("users", "team-tile hand-tile"), mk("div", {},
    mk("h3", { class: "tv-h is-big" }, "This team works on the side of another chat"),
    mk("p", { class: "bes-line" }, "Its result waits on its card there, with Send to your agent and Verify, then send…; a team on the side sends no team of its own."),
    io.openMain ? mk("button", { class: "inst-btn", type: "button", onclick: () => io.openMain?.() }, "Open the main chat") : null));
  const ofGrid = mk("div", { class: "bes-grid" });
  /**
   * The grid let go of what it shows, where the boards and cards it holds are let go too: a board or card made again for
   * a team would be drawn over the stale one it still held, by its key, the stale one's workers kept (`data-placed`).
   */
  const letGrid = () => place(grid, []);

  /** A switch with its words. @param {"verify" | "notify"} k @param {boolean} on @param {() => void} flip */
  const switchRow = (k, on, flip) => [toggle(mk, on, SWITCH_WORDS[k].label, flip), mk("span", { class: "bes-switch-label", title: SWITCH_WORDS[k].title }, SWITCH_WORDS[k].label)];

  // ---- the cards ----------------------------------------------------------------------------------------------------
  /** @type {Map<string, { el: any, key: string }>} */
  const cards = new Map();
  /** The folded rows opened again into their cards, this page's. @type {Set<string>} */
  const unfolded = new Set();

  /**
   * A result's findings as a card or a mark shows them (§10 O3): its chips, its first few with where each is, and a
   * line for the rest that opens it beside. A title is its lead's words: its code drawn as code, the rest text. @param {import("../lib/beside.js").BesideRow} r
   */
  const findingsOf = (r) => {
    const f = r.findings;
    if (!f) return null;
    const more = moreWords(f);
    return mk("div", { class: "bes-findings" },
      ...f.top.map((x) => {
        // Its confidence: how many Hunters found it on their own, where several did (the plan's p6).
        const by = foundByMark(x);
        return mk("div", { class: "bes-finding" }, mk("span", { class: `trp-dot t-${FINDING_WORDS[x.kind].tone}`, "aria-hidden": "true" }), mk("span", { class: "bes-finding-t" }, ...inlineMarks(mk, x.title)), by ? mk("span", { class: "bes-finding-by", title: by.title }, by.text) : null, x.where ? mk("code", { class: "bes-finding-w" }, x.where) : null);
      }),
      more && io.openResult ? mk("button", { class: "br-link bes-more", type: "button", onclick: () => io.openResult?.(r.id) }, `${more} — open beside`, glyph("chevronRight", "br-link-ic")) : more ? mk("span", { class: "bes-note" }, more) : null);
  };

  /** An ended team folded to a row (§10 O2, O3): its name, how it ended, where its result went. @param {import("../lib/beside.js").BesideRow} r */
  function rowOf(r) {
    const t = now();
    const chips = findingChips(r.findings).slice(0, 2).map((c) => c.words);
    return mk("div", { class: `bes-row is-${r.state}`, "data-beside": r.id, "data-key": `row:${r.id}`, role: "group", "aria-label": `${r.team.name} team, ${BESIDE_BADGE[r.state].toLowerCase()}` },
      portrait(r.team.key, "s28"),
      mk("b", {}, r.team.name),
      mk("span", { class: "bes-row-words" }, [BESIDE_BADGE[r.state], ...chips, notifiedWords(r) || (r.verifiedBy ? CHECKING_WORDS : ""), r.result?.at ? ago(r.result.at, t) : r.at ? ago(r.at, t) : ""].filter(Boolean).join(" · ")),
      mk("span", { class: "th-sp" }),
      r.result && io.openResult ? mk("button", { class: "br-link", type: "button", "data-key": "beside", onclick: () => io.openResult?.(r.id) }, "Open beside") : null,
      mk("button", { class: "br-link", type: "button", "data-key": "open", onclick: () => io.open(r.id) }, r.state === "done" ? "Ask its lead" : "Open its chat"),
      mk("button", { class: "bes-fold", type: "button", "data-key": "fold", title: "Its card", "aria-label": `Unfold the ${r.team.name} team's card`, html: ICONS.chevronDown, onclick: () => { unfolded.add(r.id); paintSection(); } }));
  }
  /**
   * @param {import("../lib/beside.js").BesideRow} r
   * @param {boolean} [here]  shown in the team's own chat: its result goes on from its main chat's card, and its chat is
   *   this one
   */
  function cardOf(r, here = false) {
    const t = now();
    const acts = here ? { ...cardActions(r, teamsOn(state.config)), notify: false, verify: false } : cardActions(r, teamsOn(state.config));
    const key = JSON.stringify([r, Math.floor((t - r.at) / 60_000), unfolded.has(r.id), here]);
    const had = cards.get(r.id);
    if (had?.key === key) return had.el;
    const checks = r.of ? (io.rows().find((x) => x.id === r.of)?.team.name || "a team") : "";
    /** A button of its foot, keyed by what it does: one that comes or goes leaves the others where they stood. */
    const button = (/** @type {string} */ label, /** @type {string} */ title, /** @type {() => void} */ fn, /** @type {string} */ key, primary = false) => mk("button", { class: `inst-btn${primary ? " is-primary" : ""}`, type: "button", "data-key": key, title, onclick: fn }, label);
    // The card stays while it shows, its parts drawn again in place as what it says moves.
    const el = had?.el || mk("section", { "data-beside": r.id, "data-key": `card:${r.id}` });
    el.setAttribute("class", `bes-card is-${r.state}`);
    el.setAttribute("aria-label", `${r.team.name} team on the side of this chat`);
    drawIn(el, [
      mk("div", { class: "bes-card-top", "data-key": "top" },
        portrait(r.team.key, "s36"),
        mk("div", { class: "bes-card-who" },
          mk("div", { class: "bes-card-name" }, r.team.name, mk("span", { class: "th-tag is-side" }, glyph("columns2", "th-tag-ic"), "On the side")),
          mk("div", { class: "bes-card-by" }, [firedWords(r), r.at ? ago(r.at, t) : "", checks ? `checks the ${possessive(checks)} result` : ""].filter(Boolean).join(" · "))),
        mk("span", { class: `tg-badge is-${r.state === "working" ? "running" : r.state === "asking" ? "asking" : r.state === "done" ? "done" : "stopped"}` }, BESIDE_BADGE[r.state]),
        unfolded.has(r.id) ? mk("button", { class: "bes-fold", type: "button", "data-key": "fold", title: "Fold it to a row", "aria-label": `Fold the ${r.team.name} team's card`, html: ICONS.chevronUp, onclick: () => { unfolded.delete(r.id); paintSection(); } }) : null),
      r.findings ? mk("div", { class: "bes-card-chips" }, ...findingChips(r.findings).map((c) => mk("span", { class: `trp-chip t-${c.tone}` }, c.words))) : null,
      mk("p", { class: "bes-card-ask", title: r.ask }, `“${r.ask}”`),
      onWords(r.on) ? mk("p", { class: "bes-card-on" }, onWords(r.on)) : null,
      ...fellWords(r.on).map((w) => mk("p", { class: "bes-note is-warn" }, glyph("shieldAlert", "bes-note-ic"), w)),
      stateLine(r) ? mk("p", { class: "bes-card-state" }, stateLine(r)) : null,
      // Its findings ranked where its lead wrote the list (§10 O3), else its result in short.
      r.result && r.findings ? findingsOf(r) : null,
      r.result && !r.findings ? mk("div", { class: "bes-card-result" }, mk("div", { class: "bes-result-text" }, r.result.text), r.result.more ? mk("span", { class: "bes-note" }, "Open beside for the rest") : null) : null,
      notifiedWords(r) ? mk("p", { class: "bes-card-sent" }, glyph("check", "bes-note-ic"), notifiedWords(r)) : null,
      r.verifiedBy ? mk("p", { class: "bes-card-sent" }, glyph("shieldCheck", "bes-note-ic"), "BugHunters checks its result: its card is above") : null,
      acts.switches
        ? mk("div", { class: "bes-card-switches", "data-key": "switches" }, mk("span", { class: "bes-when" }, "when done:"),
            r.checked ? null : mk("div", { class: "bes-switch-row" }, ...switchRow("verify", r.verify, () => io.set(r.id, { verify: !r.verify }))),
            mk("div", { class: "bes-switch-row" }, ...switchRow("notify", r.notify, () => io.set(r.id, { notify: !r.notify }))))
        : null,
      mk("div", { class: "bes-card-foot", "data-key": "foot" }, ...kids([
        acts.notify ? button("Send to your agent…", "Its result in your message box, as an attachment: add your words, and Send sends it", () => io.notify(r.id), "notify", true) : null,
        acts.verify ? button("Verify, then send…", "Open BugHunters' Brief, filled with its result as the claims to check: Send starts it, and its check goes to your agent when it ends", () => io.verify(r.id), "verify") : null,
        acts.resume ? button("Resume…", "Open its conversation with Go on in the box; Send goes on from where it was", () => io.resume(r.id), "resume") : null,
        here ? null : button(r.state === "done" ? "Ask its lead" : "Open its chat", r.state === "done" ? "Its conversation: ask its lead about what it found" : "Its conversation: its lead, its workers, its questions", () => io.open(r.id), "open"),
        r.result && io.openResult ? button("Open beside", "Its result whole, ranked, in a tile beside the chat", () => io.openResult?.(r.id), "beside") : null,
        acts.stop ? button("Stop", "Stop its lead and every worker of its", () => io.stop(r.id), "stop") : null,
        // Where it stands with your agent; one its switch could not hand on says what was tried and why (`is-missed`).
        r.result && !notifiedWords(r) ? mk("span", { class: `bes-seen${missedWords(r) ? " is-missed" : ""}` }, seenWords(r, { send: acts.notify })) : null,
      ]))]);
    cards.set(r.id, { el, key });
    return el;
  }

  function paintSection() {
    // A team's own chat runs beside another: it sends none of its own, says whose it is, and shows itself as its main
    // chat's Teams tab does — its live board while it works or asks, its card once it ended (the owner's words of
    // 10-19: the two tabs showed different activity).
    const of = io.main?.() || null;
    if (of) {
      const me = io.self?.() || null;
      const mine = !!me && !!boards && (me.state === "working" || me.state === "asking");
      boards?.keep(mine && me ? [me.id] : []);
      for (const id of [...cards.keys()]) if (id !== me?.id) cards.delete(id);
      // Its board or card straight into its grid, itself: put in a grid made anew, it left the page at every pulse.
      drawIn(ofGrid, me ? [mine ? /** @type {any} */ (boards).boardOf(me) : cardOf(me, true)] : []);
      place(el, kids([ofHead, me ? ofGrid : null]));
      letGrid();
      return;
    }
    place(ofGrid, []);
    const all = io.rows();
    for (const id of [...cards.keys()]) if (!all.some((r) => r.id === id)) cards.delete(id);
    for (const id of [...unfolded]) if (!all.some((r) => r.id === id && foldsToRow(r))) unfolded.delete(id);
    const rows = only ? all.filter((r) => r.id === only) : all;
    const working = rows.filter((r) => r.state === "working").length;
    const asking = rows.filter((r) => r.state === "asking").length;
    head.replaceChildren("On the side", headFig);
    // Send a team… while Settings › Experimental's Teams switch is on; a team already at work still shows.
    sendBtn.classList.toggle("hidden", !teamsOn(state.config));
    headFig.replaceChildren([working ? `${working} at work` : "", asking ? `${asking} ${asking === 1 ? "asks" : "ask"} you` : "", !working && !asking && rows.length ? String(rows.length) : ""].filter(Boolean).join(" · "));
    // A team at work or asking: its live board, where the host follows them; one that ended: its card — folded to a row
    // once its result went to your agent or to BugHunters' check (§10 O3). Alone in its row's pane, an ended one is its card whole.
    const live = (/** @type {import("../lib/beside.js").BesideRow} */ r) => !!boards && (r.state === "working" || r.state === "asking");
    boards?.keep(rows.filter(live).map((r) => r.id));
    drawIn(grid, rows.map((r) => (live(r) ? /** @type {any} */ (boards).boardOf(r) : !only && foldsToRow(r) && !unfolded.has(r.id) ? rowOf(r) : cardOf(r))));
    grid.classList.toggle("is-one", !!only);
    const strip = working || asking ? roomStrip(io.room?.() || null) : [];
    drawIn(roomEl, strip.length ? [
      mk("span", { class: "br-cap" }, "Room now"),
      ...strip.map((x) => mk("span", { class: `bes-room-m${x.full ? " is-full" : ""}` }, mk("b", {}, x.name), ` ${x.words}`)),
      mk("span", { class: "th-sp" }),
      io.openSlots ? mk("button", { class: "br-link", type: "button", title: "Settings › Providers: each model's limit, on its row", onclick: () => io.openSlots?.() }, "Each model's limit…") : null,
    ] : []);
    if (only) {
      place(el, kids([rows.length ? grid : mk("p", { class: "bes-line" }, "This team is no longer on the side of this chat."), strip.length ? roomEl : null]));
      return;
    }
    place(el, kids([
      headBox,
      rows.length ? grid : null,
      strip.length ? roomEl : null,
    ]));
  }

  return {
    el,
    /** @param {any} c @param {string | null} [one]  the one team to paint alone */
    paint(c, one = null) {
      if (c?.chainId !== chat?.chainId) cards.clear();
      chat = c;
      only = one;
      if (!chat?.chainId) {
        place(el, []);
        letGrid();
        return;
      }
      paintSection();
    },
    /** Whether a team works or worked on the side of this chat. */
    has: () => io.rows().length > 0,
    /** Whether this chat is a team's own, on the side of another. */
    isTeamChat: () => !!io.main?.(),
  };
}
