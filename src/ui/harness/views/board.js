// @ts-check
// A working team's live board on the Teams tab (team_v2_plan §10 O2, the mock of 10-19): its head — the lead's
// portrait, the team, On the side, who sent it and when, its ask, its two switches, Open its chat and Stop — then its
// lead's frame (its model, its state, its newest words, this round's calls, its rounds and spend) beside a frame per
// worker: its portrait and number, its state in a word and a tone (at work, asks you, asked its lead, reported, waits
// for a slot), what it does now, its newest words, its slice, its rounds and a bar for how full its window is. A worker
// that asks you gets Allow, Always allow and Deny… on a bar over the frames — answered here, in its team's chat. The
// foot: a pip per worker and the board's line. The words are lib/boards.js's; every press goes through the host.
import { h, morphChildren, standing } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { prettyModel } from "../lib/families.js";
import { toggle } from "../lib/fields.js";
import { ago, inlineMarks } from "../widgets/kit.js";
import { leadLook } from "../lib/brief.js";
import { SWITCH_WORDS, firedWords } from "../lib/beside.js";
import { askWords } from "../lib/team.js";
import { answerControls, answersKey } from "../conversation/decisions.js";
import { boardFoot, framesOf, leadState, orderLines } from "../lib/boards.js";

/**
 * What a board reads and does — the host's. `answer`/`always`: a worker's question answered in its team's chat;
 * `openWorker`: its thread, in its team's chat's Sub Agents tab.
 * @typedef {{
 *   rows: (tid: string) => any[],
 *   known: (tid: string) => boolean,
 *   lead: (tid: string) => import("../lib/beside.js").LeadNow | null,
 *   set: (id: string, patch: { verify?: boolean, notify?: boolean }) => void,
 *   stop: (id: string) => void,
 *   open: (id: string) => void,
 *   here?: (tid: string) => boolean,
 *   openWorker: (tid: string, id: string) => void,
 *   answer: (tid: string, id: string, a: import("../conversation/decisions.js").WorkerAnswer) => Promise<boolean>,
 *   always: (tid: string, id: string, offer: any, ask: number | null) => Promise<boolean>,
 *   usd?: (n: number) => string,
 *   now?: () => number,
 * }} BoardIO
 */

/**
 * @param {BoardIO} io
 * @param {{ h?: typeof h, place?: (parent: any, wanted: any[]) => void, drawIn?: (parent: any, nodes: any[]) => void }} [o]
 *   the tests' fake DOM, its `place`, and how a board's parts are drawn again: in place (dom.js `morphChildren`)
 * @returns {{ boardOf: (r: import("../lib/beside.js").BesideRow) => any, keep: (ids: string[]) => void }}
 */
export function createBoards(io, o = {}) {
  const mk = o.h || h;
  const place = o.place || ((/** @type {any} */ p, /** @type {any[]} */ k) => p.replaceChildren(...k));
  const drawIn = o.drawIn || morphChildren;
  const now = io.now || Date.now;
  const usd = io.usd || ((/** @type {number} */ n) => `$${n.toFixed(2)}`);
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "inst-ic") => mk("span", { class: cls, "aria-hidden": "true", html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  /** @param {{ icon: string, tone: string }} look @param {string} size @param {{ crown?: boolean, cls?: string, n?: number }} [x] */
  const portrait = (look, size, x = {}) =>
    mk("span", { class: `pf ${size} t-${look.tone}${x.cls ? ` ${x.cls}` : ""}`, "aria-hidden": "true" }, glyph(look.icon, "pf-ic"), x.crown ? glyph("crown", "pf-crown") : null, x.n ? mk("span", { class: "pf-num" }, String(x.n)) : null);

  /**
   * Each team's board while it shows, by the team's id: the element kept, its parts drawn again in place as what it
   * says moves — at every pulse of its workers —, so its Stop, its switches and a worker's frame under a resting pointer
   * stay the elements they were (the owner's of 11-01: buttons blinking, clicks lost).
   * @type {Map<string, { el: any, key: string }>}
   */
  const built = new Map();
  /** A worker's question bar, kept while the same call waits: a half-typed why survives. @type {Map<string, { key: string, el: any }>} */
  const asks = new Map();

  /** @param {string} tid @param {import("../lib/boards.js").Frame} f @param {any} row */
  const askBar = (tid, f, row) => {
    const a = row.progress.asking;
    const key = answersKey(a);
    const had = asks.get(`${tid}\0${f.id}`);
    if (had?.key === key) return had.el;
    const w = askWords(a);
    const words = a.command ? a.reason : a.question;
    // Keyed by its worker: new to a board that stands, it goes in as itself, never drawn over the grid beside it by tag.
    const el = mk("div", { class: "bd-ask", role: "group", "data-key": `ask:${f.id}`, "aria-label": `${f.name} ${f.n} asks you` },
      portrait(f.look, "s28", { n: f.n }),
      mk("div", { class: "bd-ask-text" },
        mk("div", { class: "bd-ask-q" }, mk("b", {}, `${f.name} ${f.n} asks you:`), ` ${w.verb.replace(/^wants to/, "may it")}`, w.what ? mk("code", { title: w.whole }, w.what) : null),
        words ? mk("div", { class: "bd-ask-sub" }, ...inlineMarks(mk, String(words))) : null),
      answerControls(mk, {
        id: f.id,
        who: `${f.name} ${f.n}`,
        n: a.n,
        offer: a.offer || null,
        answer: (id, said) => io.answer(tid, id, said),
        always: (id, offer, ask) => io.always(tid, id, offer, ask),
        place,
        ...(a.always ? { onlyAlways: true } : {}),
      }).el);
    asks.set(`${tid}\0${f.id}`, { key, el });
    return el;
  };

  /** @param {string} tid @param {import("../lib/boards.js").Frame} f */
  const frame = (tid, f) => {
    const waits = f.tone === "wait";
    return mk("button", { class: `bd-fr is-${f.tone}`, type: "button", "data-id": f.id, "data-key": f.id, title: `Open ${f.name} ${f.n}'s conversation`, onclick: () => io.openWorker(tid, f.id) },
      mk("span", { class: "bd-fr-top" },
        waits ? mk("span", { class: "pf s32 is-wait", "aria-hidden": "true" }, glyph("hourglass", "pf-ic"), mk("span", { class: "pf-num" }, String(f.n))) : portrait(f.look, "s32", { n: f.n }),
        mk("span", { class: "bd-fr-who" }, mk("b", {}, `${f.name} ${f.n}`), mk("span", { class: `bd-fr-state is-${f.tone}` }, f.state))),
      waits
        ? mk("span", { class: "bd-fr-body" },
            f.wait ? mk("span", { class: "bd-fr-line" }, f.wait) : null,
            f.slice ? mk("span", { class: "bd-fr-slice" }, `Its slice: ${f.slice}`) : null,
            mk("span", { class: "bd-fr-note" }, "starts by itself once a slot frees"))
        : mk("span", { class: "bd-fr-body" },
            f.tool ? mk("span", { class: "bd-fr-tool", title: `${f.tool.name} ${f.tool.args}` }, glyph("wrench", "bd-fr-ic"), mk("b", {}, f.tool.name), f.tool.args ? ` ${f.tool.args}` : "") : null,
            f.words ? mk("span", { class: "bd-fr-words", title: f.words }, f.words) : null),
      waits ? null : mk("span", { class: "bd-fr-foot" },
        mk("span", { class: "bd-fr-bar", title: f.fill != null ? `Its window: ${Math.round(f.fill * 100)}% full` : "Its window: not known yet" }, mk("i", { style: `width:${Math.round((f.fill || 0) * 100)}%` })),
        mk("span", { class: "bd-fr-figs" }, [f.slice, f.rounds ? `${f.rounds} ${f.rounds === 1 ? "round" : "rounds"}` : ""].filter(Boolean).join(" · "))));
  };

  /** @param {import("../lib/beside.js").BesideRow} r */
  function boardOf(r) {
    const t = now();
    const rows = io.rows(r.id);
    const lead = io.lead(r.id);
    const frames = framesOf(rows, t);
    // Its workers' asks by number too: the same call asked again is another ask, its bar drawn anew (`answersKey`).
    const asked = rows.map((x) => x?.progress?.asking?.n ?? null);
    const key = JSON.stringify([r, lead, frames, asked, io.known(r.id), Math.floor((t - r.at) / 60_000), !!io.here?.(r.id)]);
    const had = built.get(r.id);
    if (had?.key === key) return had.el;
    const state = leadState(r, lead, frames);
    // In the team's own chat, Open its chat has nowhere to go.
    const here = !!io.here?.(r.id);
    const orders = orderLines(lead, frames);
    const foot = boardFoot(frames, lead, usd);
    const switchRow = (/** @type {"verify" | "notify"} */ k, /** @type {boolean} */ on) =>
      mk("span", { class: "bd-switch", title: SWITCH_WORDS[k].title }, toggle(mk, on, SWITCH_WORDS[k].label, () => io.set(r.id, { [k]: !on })), SWITCH_WORDS[k].label);
    const asking = frames.filter((f) => f.tone === "asks").map((f) => askBar(r.id, f, rows.find((x) => String(x.id) === f.id)));
    for (const k of [...asks.keys()]) if (k.startsWith(`${r.id}\0`) && !frames.some((f) => f.tone === "asks" && k === `${r.id}\0${f.id}`)) asks.delete(k);
    // Its question bars, kept while their calls wait, go into its side as themselves once the rest is drawn — never
    // inside a part made for this draw, which would take them off the page.
    const side = mk("div", { class: "bd-side", "data-placed": "" });
    const el = had?.el || mk("section", { "data-board": r.id, "data-key": `board:${r.id}` });
    el.setAttribute("class", `bd is-${r.state}`);
    el.setAttribute("aria-label", `${r.team.name} team at work on the side of this chat`);
    drawIn(el, [
      mk("div", { class: "bd-head" },
        portrait(leadLook(r.team.key), "s36", { crown: true }),
        mk("div", { class: "bd-who" },
          mk("div", { class: "bd-name" }, mk("b", {}, r.team.name), mk("span", { class: "th-tag is-side" }, glyph("columns2", "th-tag-ic"), "On the side"),
            mk("span", { class: "bd-by" }, [firedWords(r), r.at ? ago(r.at, t) : ""].filter(Boolean).join(" · "))),
          mk("div", { class: "bd-ask-line", title: r.ask }, `“${r.ask}”`)),
        mk("span", { class: "th-sp" }),
        mk("div", { class: "bd-switches" }, mk("span", { class: "bes-when" }, "when done:"), r.checked ? null : switchRow("verify", r.verify), switchRow("notify", r.notify)),
        here ? null : mk("button", { class: "inst-btn", type: "button", title: "Its conversation: its lead, its workers, its questions", onclick: () => io.open(r.id) }, glyph("messageSquare", "inst-ic"), "Open its chat"),
        mk("button", { class: "inst-btn is-danger", type: "button", title: "Stop its lead and every worker of its", onclick: () => io.stop(r.id) }, "Stop")),
      mk("div", { class: "bd-body" },
        mk("div", { class: `bd-lead is-${state.tone}` },
          // Its lead's conversation is its team's chat: pressed, its face opens it, as a worker's frame opens the worker's
          // thread. In the team's own chat it is that conversation already.
          mk(here ? "div" : "button", { class: "bd-lead-top", ...(here ? {} : { type: "button", title: "Open its chat: its lead's conversation, with every worker it sent", onclick: () => io.open(r.id) }) },
            portrait(leadLook(r.team.key), "s56", { crown: true, cls: "ring-gold" }),
            mk("div", { class: "bd-lead-who" },
              mk("b", {}, "Its lead"),
              r.on?.lead || r.model ? mk("span", { class: "br-chip-model" }, prettyModel(String(r.on?.lead || r.model))) : null,
              mk("span", { class: `bd-lead-state is-${state.tone}` }, state.tone === "work" ? glyph("loader", "bd-spin") : null, state.words))),
          lead?.words ? mk("div", { class: "bd-lead-words" }, ...inlineMarks(mk, lead.words)) : null,
          orders.length ? mk("div", { class: "bd-round" }, mk("span", { class: "br-cap" }, "This round"),
            ...orders.map((x) => mk("div", { class: `bd-order${x.open ? " is-open" : ""}`, ...(x.tip ? { title: x.tip } : {}) }, glyph(x.icon, "bd-order-ic"), mk("span", {}, x.words)))) : null,
          mk("div", { class: "bd-lead-foot" },
            mk("span", {}, [lead?.rounds ? `${lead.rounds} ${lead.rounds === 1 ? "round" : "rounds"}` : "", lead && lead.usd > 0 ? usd(lead.usd) : ""].filter(Boolean).join(" · ")),
            mk("span", { class: "th-sp" }),
            here ? null : mk("button", { class: "br-link", type: "button", onclick: () => io.open(r.id) }, "Open its chat", glyph("chevronRight", "br-link-ic")))),
        side),
      mk("div", { class: "bd-foot" },
        mk("span", { class: "bd-pips", "aria-hidden": "true" }, ...foot.pips.map((tone) => mk("i", { class: `is-${tone}` }))),
        mk("span", { class: "bd-foot-words" }, foot.words),
        mk("span", { class: "th-sp" }),
        frames.length ? mk("span", { class: "bd-foot-hint" }, "the bar under a worker is how full its window is") : null)]);
    drawIn(standing(side), [
      ...asking,
      frames.length
        ? mk("div", { class: "bd-grid", "data-key": "grid" }, ...frames.map((f) => frame(r.id, f)))
        : mk("p", { class: "bd-none", "data-key": "none" }, io.known(r.id) ? "Its lead has sent no worker yet: they show here as it does." : "Reading its workers…")]);
    built.set(r.id, { el, key });
    return el;
  }

  return {
    boardOf,
    /** Let go of the boards of teams no longer shown. @param {string[]} ids */
    keep(ids) {
      for (const id of [...built.keys()]) if (!ids.includes(id)) built.delete(id);
      for (const k of [...asks.keys()]) if (!ids.includes(k.split("\0")[0])) asks.delete(k);
    },
  };
}
