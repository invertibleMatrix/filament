// @ts-check
// The chat's list's chip and its editor (HarnessV4_Tasks E15 step 8, AG-240): one chip says a list of models in a line
// ("GLM-5.3 · GLM-5.3 Flash") and opens it: each model in the order a launch takes them, what the model costs, and
// under a row why it is passed or takes fewer now, as the server reads it for the rows on screen (POST
// /api/subagents/seats). The list is the chat's (`subagents.pool`) — its agents', its team crews' and its plan's tasks'
// alike since U13-D14 — on the Agents tab and the Start board's card. Each row says how hard its agents think on its
// model beside it (lib/effort-chip.js; the owner's word of 11-05: rows are model · account · effort). It is written once, when
// the editor closes, if it changed; "Use the default" clears the chat's own list at once. It is an order (U13-D15): no
// row holds a count, and the next model takes an agent where one is at its limit — a model's own, set under its
// provider; none set, none.
import { h } from "../../lib/dom.js";
import { WORDS } from "../lib/words.js";
import { menu as openMenu, popover } from "../lib/ui.js";
import { effortChip } from "../lib/effort-chip.js";
import { ICONS } from "../lib/icons.js";
import { prettyModel } from "../lib/families.js";
import { createModelSelect } from "../composer/model.js";
import {
  MAIN_ROW, POOL_ROWS, addProblem, movedRow, poolFrom, poolLine, poolRows, priceWords, rowNote, samePool, withEffort, withModel, withRow, withoutRow,
} from "../lib/pool.js";

/** @typedef {import("../lib/pool.js").PoolRow} PoolRow */
/** @typedef {import("../lib/pool.js").SeatFacts} SeatFacts */

/** The head's note once the list on screen differs from the stored one: the editor has no Save (AG-245). */
export const POOL_UNSAVED = "saved when you close";
/** The editor's foot: how an agent takes a model, and what limits one. */
export const POOL_FOOT =
  "An agent takes the first model with room, from the top: one at its limit, one that cannot run now or one that fails passes it to the next. A card with a model of its own runs on that model. A model's limit across your chats is set on its row under its provider in Settings; with none set, it has none.";

/**
 * @typedef {object} PoolChipIO
 * @property {() => unknown} rows  the list in force (the setting's value)
 * @property {() => string} [source]  the settings layer it comes from; none where the list is nobody's own (the global one)
 * @property {(rows: PoolRow[]) => { note: string, title: string } | null} [from]  where the list in force comes from,
 *   for the editor's head and the chip's tooltip, where `poolFrom` of `source` would not say it; null says nothing
 * @property {() => string} [main]  the main agent's model, "" where there is none to name
 * @property {() => any[]} models  the catalogue's rows, for a row's model picker
 * @property {() => any[]} [families] @property {() => any[]} [accounts]
 * @property {(rows: PoolRow[]) => Promise<{ seats: SeatFacts[], total: number } | null>} [facts]  the rows as a launch
 *   would read them now
 * @property {(rows: PoolRow[]) => void} onChange  the edited list, once, as the editor closes
 * @property {() => void} onUseDefault
 * @property {string | (() => string)} [label]  the editor's head: whose agents these are
 * @property {string} [defaultWords]  what "Use the default" does here, for its tooltip
 * @property {string} [mainWords]  the nameless row's words where no main agent's model is known
 * @property {() => string} [tag]  a word on the chip before its list: whose list it is ("This chat" — the Agents tab's,
 *   the owner's 10-25); none where it is ""
 * @property {() => { level: string, desc: string }} [inherit]  what a row that says no effort thinks at, and why: the
 *   main agent's effort where none is given
 * @property {() => string | null} [line]  the chip's words where its owner says them, not its rows': a Brief's pick
 *   for a crew, said whole
 * @property {string} [foot]  the editor's foot, where how a model is taken reads otherwise here
 */
/** What a row that says no effort thinks at, where its owner does not say. */
const MAIN_EFFORT = Object.freeze({ level: "model", desc: "The main agent's effort" });

/**
 * @param {PoolChipIO} io
 * @param {{ h?: typeof h, popover?: typeof popover, modelSelect?: typeof createModelSelect, menu?: typeof openMenu }} [o]  the test's stand-ins
 * @returns {{ el: HTMLElement, paint: () => void, open: () => void }}  `paint` is its owner's to call, the first
 *   time too: the chip reads nothing of `io` until then, since a view is made before the page's session state is
 */
export function createPoolChip(io, o = {}) {
  const mk = o.h || h;
  const pop = o.popover || popover;
  const modelSelect = o.modelSelect || createModelSelect;
  const labelNow = () => (typeof io.label === "function" ? io.label() : io.label) || WORDS.chatSeatsEditor;
  const main = () => String(io.main?.() || "");
  /** The list in force as the editor shows it: an order. */
  const stored = () => poolRows(io.rows());
  /** Where the list in force comes from, or null where nothing says it. @param {PoolRow[]} rows */
  const fromOf = (rows) => (io.from ? io.from(rows) : io.source ? poolFrom(rows, io.source()) : null);

  const tag = mk("span", { class: "pool-chip-tag" });
  const line = mk("span", { class: "pool-chip-line" });
  const chip = mk("button", { class: "pool-chip", type: "button", "aria-haspopup": "dialog", onclick: (/** @type {any} */ e) => { e?.stopPropagation?.(); open(); } },
    tag, line, mk("span", { class: "mode-caret", html: ICONS.chevronsUpDown }));
  const paint = () => {
    const rows = stored();
    const whole = io.line?.() || poolLine(rows, main());
    const whose = io.tag?.() || "";
    tag.replaceChildren(...(whose ? [whose] : []));
    line.replaceChildren(whole);
    // The line whole first: a narrow place cuts it with an ellipsis.
    chip.setAttribute("title", `${whole}\n${fromOf(rows)?.title || io.foot || POOL_FOOT}`);
  };

  const open = () => {
    const label = labelNow();
    let draft = stored();
    /** What the server said of the draft's rows: one seat row per model. @type {SeatFacts[]} */
    let seats = [];
    let asked = 0;
    let closed = false;
    /** Where the stored list comes from; once the list on screen differs, how it is saved. */
    const fromEl = mk("span", { class: "pool-from" });
    const from = fromOf(stored());
    const list = mk("div", { class: "pool-rows" });
    const adds = mk("div", { class: "pool-add" });

    /** A row's facts: a named row's by its name; the nameless one's are the main agent's model's. @param {PoolRow} r */
    const factsOf = (r) => (r.model ? seats.find((s) => s.model === r.model) : seats.find((s) => s.own) || seats.find((s) => !s.model)) || null;
    const ask = async () => {
      if (!io.facts) return;
      const n = ++asked;
      const got = await io.facts(draft).catch(() => null);
      // An answer for rows edited since, or for an editor that closed, says nothing of what is on screen.
      if (closed || n !== asked) return;
      seats = got?.seats || [];
      redraw();
    };
    /** @param {PoolRow[]} next */
    const edit = (next) => {
      if (next === draft) return;
      draft = next;
      redraw();
      void ask();
    };

    /** A row's model: a picker of its own for a named row, words for the nameless one. @param {PoolRow} r @param {number} i */
    const modelOf = (r, i) => {
      if (!r.model)
        return mk("span", { class: "pool-main" }, MAIN_ROW, main() ? mk("span", { class: "pool-main-name" }, prettyModel(main())) : io.mainWords ? mk("span", { class: "pool-main-name" }, io.mainWords) : null);
      const sel = modelSelect({ onChange: (name) => { if (name) edit(withModel(draft, i, name)); } });
      sel.setModels(io.models() || []);
      sel.setFamilies(io.families?.() || []);
      sel.setAccounts(io.accounts?.() || []);
      sel.set(r.model);
      return sel.el;
    };
    /** How hard a row's agents think on its model: the main agent's model's for the nameless row. @param {PoolRow} r @param {number} i */
    const effortOf = (r, i) => {
      const model = r.model || main();
      return effortChip({
        label: `How hard it thinks on ${model ? prettyModel(model) : MAIN_ROW}`,
        value: r.effort || "",
        onChange: (level) => edit(withEffort(draft, i, level)),
        model: () => model,
        families: () => io.families?.() || [],
        inherit: () => io.inherit?.() || MAIN_EFFORT,
        mk,
        ...(o.menu ? { menu: o.menu } : {}),
      }).el;
    };
    /** @param {string} icon @param {string} title @param {boolean} off @param {() => void} go */
    const act = (icon, title, off, go) => mk("button", { class: "pool-act", type: "button", title, "aria-label": title, ...(off ? { disabled: "" } : {}), onclick: () => { if (!off) go(); } }, mk("span", { class: "pool-act-ic", html: ICONS[icon] || "" }));

    const draw = () => {
      const where = samePool(draft, stored()) ? from?.note || "" : POOL_UNSAVED;
      fromEl.replaceChildren(...(where ? [where] : []));
      list.replaceChildren(...draft.map((r, i) => {
        const f = factsOf(r);
        const note = rowNote(f);
        const price = priceWords(f?.price);
        const name = r.model ? prettyModel(r.model) : MAIN_ROW;
        return mk("div", { class: `pool-row${f?.problem ? " is-off" : ""}` },
          mk("div", { class: "pool-row-main" },
            mk("span", { class: "pool-n" }, String(i + 1)),
            mk("span", { class: "pool-model" }, modelOf(r, i)),
            effortOf(r, i),
            mk("span", { class: "pool-price", ...(price ? { title: "Per million tokens" } : {}) }, price || null),
            mk("span", { class: "pool-acts" },
              act("arrowUp", "Use it earlier", i === 0, () => edit(movedRow(draft, i, -1))),
              act("arrowDown", "Use it later", i === draft.length - 1, () => edit(movedRow(draft, i, 1))),
              act("x", draft.length > 1 ? `Take ${name} out` : "The last row stays: a session with no model could run nobody", draft.length <= 1, () => edit(withoutRow(draft, i))))),
          note ? mk("div", { class: `pool-note is-${note.tone}` }, note.text) : null);
      }));
      const full = draft.length >= POOL_ROWS;
      const add = modelSelect({ onChange: (name) => { if (name) edit(withRow(draft, name)); } });
      add.setModels(io.models() || []);
      add.setFamilies(io.families?.() || []);
      add.setAccounts(io.accounts?.() || []);
      const hasMain = draft.some((r) => !r.model);
      adds.replaceChildren(...(full
        ? [mk("span", { class: "pool-add-note" }, addProblem(draft, "") || "")]
        : [
            mk("span", { class: "pool-add-label" }, "Add a model"),
            add.el,
            hasMain ? null : mk("button", { class: "pool-add-main", type: "button", title: "A row for the model the main agent runs on, whichever it is", onclick: () => edit(withRow(draft, "")) }, MAIN_ROW),
          ].filter(Boolean)));
    };

    const box = mk("div", { class: "pool" },
      mk("div", { class: "pool-head" }, mk("span", { class: "pool-title" }, label), fromEl),
      list,
      adds,
      mk("p", { class: "pool-foot" }, io.foot || POOL_FOOT),
      mk("div", { class: "mp-foot" },
        mk("span", { class: "mp-foot-note" }, ""),
        mk("button", { class: "mp-foot-btn", type: "button", title: io.defaultWords || "Drop this chat's own list: its agents then run on its model, as its main agent does", onclick: () => { draft = stored(); d.close(); io.onUseDefault(); } },
          mk("span", { class: "mp-foot-ic", html: ICONS.rotateCcw }), "Use the default")));
    // Drawn before it is placed, and placed again whenever a row or a note changes its height: it hangs over its
    // chip, and would else grow downward across it.
    draw();
    const d = pop(chip, box, {
      side: "top", align: "end", width: 560, label,
      onClose: () => {
        closed = true;
        if (!samePool(draft, stored())) io.onChange(draft);
      },
    });
    d.el.classList?.add("aq-pop", "is-pool");
    const redraw = () => { draw(); d.place?.(); };
    void ask();
  };
  return { el: chip, paint, open };
}
