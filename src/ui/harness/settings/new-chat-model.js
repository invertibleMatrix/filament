// @ts-check
// "New chats start on" (HarnessV4_Settings_Plan HS-D16, HC-90, HC-91), under Settings › General's New chats (the
// owner's settings cleanup of 11-09): a preference of this browser's — the model you used last, or one chosen here
// while the picker offers it. The picker lists what the composer's lists. Built with an injected `h`, `api`, model
// picker and preference, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { createModelSelect } from "../composer/model.js";
import { lastModel, newChatModelPref, setNewChatModelPref } from "../state.js";

/** The row's name, as Settings search finds it. */
export const NEW_CHAT_ROW = "New chats start on";

/**
 * @param {{ onToast?: (msg: string, kind?: string) => void }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, modelSelect?: typeof createModelSelect,
 *   pref?: { get: () => string, set: (m: string) => void, last: () => string } }} [io]
 * @returns {{ el: HTMLElement, ready: Promise<void> }}
 */
export function newChatModelCard(cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const pickModel = io.modelSelect || createModelSelect;
  const pref = io.pref || { get: newChatModelPref, set: setNewChatModelPref, last: lastModel };
  const toast = cb.onToast || (() => {});
  const el = /** @type {HTMLElement} */ (m("div", { class: "prov-card mdl-start" }));
  /** @type {any[]} */
  let models = [];
  /** @type {any[]} */
  let families = [];

  function paint() {
    const chosen = pref.get();
    const offered = !chosen || !models.length || models.some((x) => String(x?.id ?? x) === chosen);
    const pick = pickModel({
      onChange: (name) => { pref.set(name); toast(`New chats start on ${name}; a chat's own picker changes it for that chat`); paint(); },
      onUseDefault: () => { pref.set(""); toast("New chats start on the model you used last"); paint(); },
      defaultDesc: "Start on the model you used last",
    });
    pick.setModels(models);
    pick.setFamilies(families);
    pick.set(chosen || pref.last());
    pick.setNote(chosen ? (offered ? "chosen for new chats" : "not offered now") : "the one you used last");
    el.replaceChildren(m("div", { class: "prov-crow" },
      m("div", { class: "prov-crow-text" },
        m("div", { class: "prov-crow-label" }, NEW_CHAT_ROW),
        m("div", { class: "prov-crow-sub" }, !chosen
          ? "The model you used last. Choose one, and every new chat starts on it; its own picker still changes it."
          : offered ? "Every new chat starts on this model; its own picker still changes it. Use the default goes back to the one you used last."
          : "It has left the picker: new chats take the model you used last until it is back or another is chosen.")),
      m("div", { class: "prov-crow-ctl" }, pick.el)));
  }

  paint();
  const ready = Promise.resolve()
    .then(() => call("/models?all=1"))
    .then((c) => { models = c?.models || c?.data || []; families = c?.families || []; paint(); }, () => {});
  return { el, ready };
}
