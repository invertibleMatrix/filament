// @ts-check
// "Use backups when a provider fails" (HC-71), at the top of Settings › Providers' list (the owner's settings cleanup of
// 11-09): the switch `rules.resilience.failover` — off unless switched on (the owner's of 11-09: "by default the
// Provider failovers should be off") — which the console's Home and the tray card hold too. A model's backups are set on its provider's page (lib/model-backups.js). Read from GET /api/failover, and
// again on a change heard on the events stream. Built with an injected `h`, `api` and the events stream, so it runs on
// the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { onBus } from "../lib/bus.js";

/** The card's name, as Settings search finds it. */
export const FAILOVER_ROW = "Use backups when a provider fails";
/** What the switch says, on and off (HC-71). */
export const FAILOVER_ON = "When a model's provider fails — a rate limit, a server error, no answer, an unknown model, a refused key — its backups are tried in order. A model's backups are set on its provider's page: Backups › on its row.";
export const FAILOVER_OFF = "Off: backups are not tried. Each model goes to its first provider only, whatever backups it has.";
/** Settings search's words for the card (search.js, HS-D68). */
export const SEARCH_ROWS = Object.freeze([{ label: FAILOVER_ROW, words: "failover fallback backups" }]);

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * @param {{ onToast?: (msg: string, kind?: string) => void, alive?: () => boolean }} [cb]  `alive`: whether the page that
 *   holds the card is still drawn (a provider's page may stand in the list's place meanwhile) — once it is not, the
 *   events stream is let go
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, subscribe?: (fn: (msg: any) => void) => () => void }} [io]
 * @returns {{ el: HTMLElement, ready: Promise<void> }}
 */
export function failoverCard(cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const subscribe = io.subscribe || onBus;
  const toast = cb.onToast || (() => {});
  const el = /** @type {HTMLElement} */ (m("div", { class: "prov-card mdl-failover" }));
  /** On, off, or null before it is read. @type {boolean | null} */
  let on = null;
  let writing = false;

  function paint() {
    const sw = m("button", { class: `set-switch${on ? " on" : ""}`, type: "button", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": FAILOVER_ROW,
      ...(on == null || writing ? { disabled: "" } : {}), onclick: () => void set(!on) });
    el.replaceChildren(m("div", { class: "prov-crow" },
      m("div", { class: "prov-crow-text" },
        m("div", { class: "prov-crow-label" }, FAILOVER_ROW),
        m("div", { class: "prov-crow-sub" }, on == null ? "Reading whether backups are on…" : on ? FAILOVER_ON : FAILOVER_OFF)),
      m("div", { class: "prov-crow-ctl" }, sw)));
  }

  /** The switch, kept at once (HC-71). @param {boolean} next */
  async function set(next) {
    writing = true;
    paint();
    try {
      const r = await call("/failover", { method: "POST", body: { enabled: next } });
      on = r?.enabled === true;
      toast(on ? "Backups are on: a model whose provider fails goes to its backups" : "Backups are off: each model goes to its first provider only");
    } catch (e) {
      toast(errText(e), "err");
    }
    writing = false;
    paint();
  }

  const read = () => call("/failover").then((r) => {
    on = r?.enabled === true;
    paint();
  }, () => {});
  const off = subscribe((msg) => {
    if (cb.alive && !cb.alive()) return off();
    if (msg?.type === "config-changed" && !writing) void read();
  });
  paint();
  return { el, ready: read() };
}
