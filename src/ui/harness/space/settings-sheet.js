// @ts-check
// A Space's own settings (the owner's of 11-04: "users can also go to each space and override model if they needed so
// that some automated work can be done over there"): the sheet its ⋯ › Space settings… and its head's runs-on line open.
// The model its agents run on, with that model's effort, over Settings › Space's — Use the default goes back to those —,
// and what an app's ask does here; each saved as it is changed, and drawn from the answer. Its foot opens Settings › Space.
// Nothing runs here.
import { h } from "../../lib/dom.js";
import { sheet } from "../lib/ui.js";
import { ASK_CHOICES, askWords, modelAt } from "../lib/space-settings.js";
import { createModelSelect } from "../composer/model.js";
import { fitEffort, modelRow } from "./model-row.js";

/**
 * A Space's own settings and what it runs on, as its answer says them (`GET /space/:project`'s `settings`, `runsOn`).
 * @typedef {{ settings: { model?: string, effort?: string, asks?: string }, runsOn: import("../lib/space-settings.js").RunsOn }} SpaceSettingsState
 */

/**
 * The sheet, open. `save`: a change, `{ model?, effort?, asks? }` — "" takes one away —, its answer the Space's settings
 * and what it runs on now, or null where it was refused (the caller says why). `openDefaults`: Settings › Space.
 * @param {{ name: string, own: boolean, now: SpaceSettingsState, nameOf: (id: string) => string,
 *   save: (patch: Record<string, string>) => Promise<SpaceSettingsState | null>, openDefaults?: () => void,
 *   catalogue?: import("./model-row.js").Catalogue, modelSelect?: typeof createModelSelect }} o
 */
export function spaceSettingsSheet({ name, own, now, nameOf, save, openDefaults, catalogue, modelSelect = createModelSelect }) {
  let at = now;
  let open = true;
  let saving = false;
  /** @type {{ close: () => void } | null} */
  let s = null;
  /** Whose the model shown is, in words. */
  const whose = () =>
    at.settings.model ? "This Space's own: its routines, an app's asks and the chats it starts run on it"
    : at.runsOn.model ? "From Settings › Space, as every Space without its own"
    : "None yet: each routine runs on the model it was made with, and an app's ask asks for one";
  const runs = modelRow({
    named: `The model ${name}'s agents run on`,
    cls: "sps-why",
    catalogue,
    modelSelect,
    blank: "Choose a model",
    defaultDesc: at.runsOn.from === "default" || (!at.settings.model && at.runsOn.model) ? "Settings › Space's model, as every Space without its own" : "Settings › Space's model — none is set there now",
    onPick: (model) => void change({ model, effort: fitEffort(catalogue, model, runs.effort()) }),
    onDefault: () => void change({ model: "" }),
    effort: { onPick: (level) => void change({ model: runs.model(), effort: level }), named: `The effort ${name}'s agents run at` },
    alive: () => open,
  });
  const asks = /** @type {HTMLSelectElement} */ (h("select", { class: "zc-input sps-asks", "aria-label": "When an app here asks an agent" }));
  asks.addEventListener("change", () => void change({ asks: asks.value }));
  const asksWhy = h("p", { class: "sp-quiet sps-asks-why" });

  /** Its parts drawn from what the Space says now. */
  const paint = () => {
    runs.show(at.runsOn.model, at.runsOn.problem ? "" : whose(), at.runsOn.effort);
    const fromDefault = at.runsOn.asksFrom === "default" ? at.runsOn.asks : "ask";
    asks.replaceChildren(
      h("option", { value: "" }, `As Settings › Space: ${askWords(fromDefault).replace(/^./, (c) => c.toLowerCase())}`),
      ...ASK_CHOICES.map((c) => h("option", { value: c.value }, c.label)),
    );
    asks.value = at.settings.asks || "";
    asksWhy.textContent =
      at.runsOn.asks === "run" ? "An app's ask runs at once, reading only, as a chat of this Space at work in the background; What happened says it was asked."
      : at.runsOn.asks === "chat" ? "An app's ask opens the Start here with its words, on this Space's model: nothing runs until you send."
      : "An app's ask opens a sheet over the app: Run it here, in the background, or Open in a chat.";
    runs.hold(saving ? "Saving…" : null);
    asks.disabled = saving;
  };

  /** A change saved; refused, what was there is drawn again. @param {Record<string, string>} patch */
  async function change(patch) {
    if (saving) return;
    saving = true;
    paint();
    const next = await save(patch);
    saving = false;
    if (next && open) at = next;
    if (open) paint();
  }

  const body = h("div", { class: "sdb-keep-body sps-body" },
    h("p", { class: "sdb-keep-lead" }, `What ${name}'s agents run on by themselves — its routines, an app's asks run here, a button's second look — and what the chats it starts start on. ${own ? "This Space's" : "Its"} own choices stand over Settings › Space's.`),
    h("h4", { class: "sdb-keep-h" }, "Its agents run on"),
    h("div", { class: "srt-sheet-v" }, runs.row),
    h("h4", { class: "sdb-keep-h" }, "When an app here asks an agent"),
    h("div", { class: "srt-sheet-v sps-asks-v" }, asks, asksWhy));
  const foot = h("div", { class: "sdb-keep-foot" },
    ...(openDefaults ? [h("button", { class: "sb-more sps-defaults", type: "button", title: "Every Space's model and what an app's ask does, where a Space chose none", onclick: () => { s?.close(); openDefaults(); } }, "Settings › Space")] : []),
    h("span", { class: "sb-sp" }),
    h("button", { class: "sm primary sps-done", type: "button", onclick: () => s?.close() }, "Done"));
  paint();
  const title = `${name}: Space settings`;
  s = sheet({ label: title, class: "sdb-keep-sheet sps-sheet", head: h("b", { class: "sp-sheet-title" }, title), body, foot, onClose: () => void (open = false) });
  return {
    close: () => s?.close(),
    /** What it says, as a line: its model at its effort, and whose. */
    words: () => `${modelAt(at.runsOn.model, at.runsOn.effort, nameOf) || "no model"} · ${whose()}`,
  };
}
