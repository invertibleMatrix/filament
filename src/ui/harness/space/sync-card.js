// @ts-check
// The Space's Tell the chats card (proposal_ux §4.14, mock-space; U5 phase 8 v2, the Sync card until
// HarnessV4_Space_Plan S1): What happened's Tell the chats… opens it and nothing is sent (rule 1). It lists each lane's
// chat, ticked, with when it hears it — now, or after its turn ends, for a chat at work — and the other chats there
// unticked under More chats; "Also tell them…" adds the person's words. Tell them sends each ticked chat one message,
// appended to its chat — the board and what the others wrote since it was last told — so their cache stays warm
// (app/space-sync.js). Then the card says how each went, as the Space hears it: sent as a turn of its own, into its
// running turn, waits for its turn to end, or not sent and why. Never on a timer: the person sends each one.
// A chat's ask to tell the chats (E42 SA-D7, the Designer's second pass) opens the card with its words quoted as its
// chat's — "From Deploy fixer: “…”", with × —, never in Also tell them…, which is the person's own; its chats ticked,
// the asker unticked ("it asked"). Tell them carries its words, and the ask is told.
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { syncLaneWords, whenWords } from "../lib/space-view.js";

/**
 * A chat the card offers: its id, its name and lane, whether it works now, whether it leads its lane.
 * @typedef {{ chain: string, name: string, chip: string, main: boolean, works: boolean, lead: boolean }} SyncChat
 */
/**
 * What the card reads and does. `chats`: the lanes' chats, leads first; `last`: the newest sync, for "since"; `run`:
 * the sync asked for, the Space's answer or null where it was refused (said); `nameOf`: a chat by its name.
 * @typedef {{ chats: () => SyncChat[], last: () => import("../lib/space-view.js").SpaceSync | null,
 *   run: (body: { lanes: { chain: string, when: "now" | "after" }[], also: string, asks?: string[] }) => Promise<any>,
 *   nameOf: (chain: string) => string, now?: () => number, plain?: () => boolean }} SyncCtx
 *   `plain`: a Space whose folder is no repository — its chats, with no lanes: no chip, no cache (the Designer, 10-29)
 */

/** @param {SyncCtx} ctx */
export function syncCard(ctx) {
  const now = ctx.now || Date.now;
  const el = h("section", { class: "sy-card", "aria-label": "Tell the chats", hidden: "" });
  /** The ticks and the whens as the person set them while the card is open, by chat. */
  /** @type {Map<string, boolean>} */
  const ticked = new Map();
  /** @type {Map<string, "now" | "after">} */
  const whens = new Map();
  let moreOpen = false;
  /** The chats' asks to tell it carries (E42 SA-D7), quoted on the card; × takes one off. @type {import("../lib/space-view.js").NeedRow[]} */
  let asks = [];
  /** The rows' words as last drawn, so a tick draws them again only where they moved. */
  let rowsKey = "";
  /** The sync this card ran, whose lanes it follows; null while it asks. @type {string | null} */
  let ran = null;
  /** @type {import("../lib/space-view.js").SpaceAnswer | null} */
  let answer = null;
  const also = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input sy-also", type: "text", maxlength: "2000", placeholder: "Also tell them…", "aria-label": "Also tell them" }));
  const said = h("span", { class: "sy-said", role: "status" });

  const close = () => {
    el.hidden = true;
    ran = null;
    ticked.clear();
    whens.clear();
    also.value = "";
    moreOpen = false;
    asks = [];
  };

  /** The chats that asked to tell the others: "it asked" beside their name. */
  const askers = () => new Set(asks.map((n) => n.ask?.chain || ""));

  /** @param {SyncChat[]} chats */
  const keyOf = (chats) => JSON.stringify(chats.map((c) => [c.chain, c.name, c.chip, c.works, c.lead]));
  /** @param {SyncChat} c */
  const whenOf = (c) => whens.get(c.chain) || (c.works ? "after" : "now");
  /** @param {SyncChat} c */
  const isTicked = (c) => ticked.get(c.chain) ?? c.lead;

  /** @param {SyncChat} c */
  function rowEl(c) {
    const box = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", ...(isTicked(c) ? { checked: "" } : {}), "aria-label": `Tell ${c.name}`, onchange: () => { ticked.set(c.chain, box.checked); paint(); } }));
    const when = c.works
      ? h("select", { class: "zc-input sy-when", "aria-label": `When ${c.name} hears it`, onchange: (/** @type {Event} */ e) => { whens.set(c.chain, /** @type {any} */ (/** @type {HTMLSelectElement} */ (e.target).value)); } },
          h("option", { value: "after", ...(whenOf(c) === "after" ? { selected: "" } : {}) }, "after its turn ends"),
          h("option", { value: "now", ...(whenOf(c) === "now" ? { selected: "" } : {}) }, "now, into its turn"))
      : h("span", { class: "sp-quiet" }, "now");
    return h("label", { class: "sy-row", "data-chain": c.chain }, box, ...(ctx.plain?.() ? [] : [h("span", { class: `sp-branch${c.main ? " is-main" : ""}` }, c.chip)]), h("span", { class: "sy-name" }, c.name),
      ...(askers().has(c.chain) ? [h("span", { class: "sp-quiet sy-asked" }, "it asked")] : []), h("span", { class: "sb-sp" }), when);
  }

  async function run() {
    const chats = ctx.chats();
    const lanes = chats.filter(isTicked).map((c) => ({ chain: c.chain, when: whenOf(c) }));
    if (!lanes.length) {
      said.replaceChildren("Tick one chat at least");
      return;
    }
    said.replaceChildren("Sending…");
    const got = await ctx.run({ lanes, also: also.value.trim(), ...(asks.length ? { asks: asks.map((n) => n.id) } : {}) });
    if (!got) {
      said.replaceChildren();
      return;
    }
    ran = String(got.sync?.id || "");
    answer = got.space || answer;
    paint();
  }

  function paint() {
    if (el.hidden) return;
    if (ran) {
      const s = answer?.syncs.find((x) => x.id === ran) || null;
      const waiting = new Set(answer?.waiting || []);
      // In place, each lane's row kept by its chat: drawn at every move of the Space while it shows how each went, and
      // its Close made anew stood under a resting pointer (the owner's of 11-01: buttons blinking under a resting
      // pointer, clicks lost).
      morphChildren(el, [
        h("div", { class: "sy-words" },
          h("div", { class: "sy-title" }, h("span", { class: "sy-tile", html: ICONS.messageSquare }), h("b", {}, "Tell the chats"), h("span", { class: "sp-quiet" }, s ? `sent at ${whenWords(s.at, now())}` : "sent")),
          h("span", { class: "sy-line" }, "Each chat got one message, added to its chat. What each writes back lands in What happened.")),
        h("div", { class: "sy-side" },
          h("div", { class: "sy-inset" }, ...(s?.lanes || []).map((l) =>
            h("div", { class: `sy-row is-${l.state}`, "data-chain": l.chain, "data-key": `row:${l.chain}` },
              h("span", { class: "sy-name" }, ctx.nameOf(l.chain)),
              h("span", { class: "sb-sp" }),
              h("span", { class: "sy-out" }, syncLaneWords(l, waiting.has(l.chain)))))),
          h("div", { class: "sy-acts" }, h("span", { class: "sb-sp" }), h("button", { class: "sm", type: "button", onclick: () => close() }, "Close"))),
      ]);
      return;
    }
    const chats = ctx.chats();
    rowsKey = keyOf(chats);
    const leads = chats.filter((c) => c.lead);
    const others = chats.filter((c) => !c.lead);
    const last = ctx.last();
    const count = chats.filter(isTicked).length;
    el.replaceChildren(
      h("div", { class: "sy-words" },
        h("div", { class: "sy-title" }, h("span", { class: "sy-tile", html: ICONS.messageSquare }), h("b", {}, "Tell the chats"), h("span", { class: "sp-quiet" }, "nothing is sent until Tell them")),
        h("span", { class: "sy-line" }, `Each agent reads the board and what the other ${ctx.plain?.() ? "chats" : "lanes"} wrote since ${last ? whenWords(last.at, now()) : "the Space began"}, then writes what changes for it. Nothing else is touched.`),
        h("span", { class: "sp-quiet" }, ctx.plain?.() ? "Adds one message to each chat you tick." : "Adds one message to each lane's chat — their cache stays warm.")),
      h("div", { class: "sy-side" },
        // Each ask's words, as its chat's (the Designer): the chats read "<chat> asked that you be told: …".
        ...asks.map((n) => h("div", { class: "sy-quote", "data-need": n.id },
          h("span", { class: "sy-quote-words" }, `From ${n.ask?.byName || "a chat"}: “${n.ask?.why || ""}”`),
          h("button", { class: "ghost icon sy-quote-x", type: "button", "aria-label": "Leave its words out", title: "Leave its words out of this send: its ask stays in Needs you", html: ICONS.x, onclick: () => { asks = asks.filter((x) => x !== n); paint(); } }))),
        h("div", { class: "sy-inset" },
          ...(leads.length ? leads.map(rowEl) : [h("p", { class: "sp-quiet sy-none" }, "No chat works here yet.")]),
          ...(others.length
            ? [h("button", { class: "sy-more", type: "button", "aria-expanded": String(moreOpen), onclick: () => { moreOpen = !moreOpen; paint(); } }, `${moreOpen ? "Fewer" : "More"} chats (${others.length})`), ...(moreOpen ? others.map(rowEl) : [])]
            : [])),
        h("div", { class: "sy-acts" },
          also,
          h("button", { class: "ghost sm", type: "button", onclick: () => close() }, "Cancel"),
          h("button", { class: "sm primary sy-run", type: "button", ...(count ? {} : { disabled: "" }), onclick: () => void run() }, "Tell them")),
        said));
  }

  return {
    el,
    /**
     * Tell the chats… pressed: the card opens to ask, or shows what it sent; nothing is sent. `asks`: a chat's ask to tell
     * the chats (E42 SA-D7) — its words quoted, the chats it names ticked and no other, the asker unticked, More chats open
     * where one is there.
     * @param {{ asks?: import("../lib/space-view.js").NeedRow[] }} [o]
     */
    open(o = {}) {
      const more = (o.asks || []).filter((n) => n.ask?.what === "tell" && !asks.some((x) => x.id === n.id));
      if (more.length) {
        if (ran) close();
        const first = !asks.length;
        asks = [...asks, ...more];
        const chats = ctx.chats();
        // The chats it names, and only they, where the card opens for it: a lane's chat it did not name is the person's to tick.
        if (first) for (const c of chats) ticked.set(c.chain, false);
        for (const n of more) for (const c of n.ask?.chats || []) ticked.set(c.chain, true);
        for (const n of asks) ticked.set(n.ask?.chain || "", false);
        if (chats.some((c) => !c.lead && ticked.get(c.chain))) moreOpen = true;
      }
      el.hidden = false;
      paint();
      el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    },
    /** The Space as it stands: a sync the card ran shows how each lane went. @param {import("../lib/space-view.js").SpaceAnswer} next */
    paint(next) {
      answer = next;
      if (ran) paint();
    },
    /** The lanes moved: an asking card draws its rows again where they changed, unless the person types in it. */
    tick() {
      if (el.hidden || ran || document.activeElement === also) return;
      if (keyOf(ctx.chats()) !== rowsKey) paint();
    },
    get isOpen() {
      return !el.hidden;
    },
  };
}
