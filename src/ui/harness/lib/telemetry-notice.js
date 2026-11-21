// @ts-check
// The one-time notice about anonymous usage statistics (the owner's of 11-10: on by default, said at the first start),
// at the sidebar's foot beside the update's: shown while Filament would send and has not said so yet (`GET /telemetry`
// answers why "notice"), never on a view-only device's page, and for people who updated as for new ones — the welcome
// tour, which updaters have seen, is not where it stands. OK or Turn off says it was shown (`POST
// /telemetry/notice-seen`, Turn off with `off: true`); until one of them, nothing is sent.
import { h, setHtml } from "../../lib/dom.js";
import { ICONS } from "./icons.js";

/** The notice's words. */
export const TELEMETRY_NOTICE = Object.freeze({
  title: "Anonymous usage stats are on",
  sub: "Once a day Filament sends counts — models, tokens, cost, runs, version, time zone — to help make it better. Never your prompts, code, paths, names or keys. Settings › Data and privacy shows exactly what went.",
});

/** Whether the notice shows for what `GET /telemetry` answered. @param {any} v */
export const noticeShows = (v) => !!v && v.armed === true && v.why === "notice";

/**
 * @param {{ api: (path: string, o?: any) => Promise<any>, viewOnly?: () => boolean, onToast?: (msg: string, kind?: string) => void }} o
 * @returns {{ el: HTMLElement }}
 */
export function telemetryNotice({ api, viewOnly = () => false, onToast = () => {} }) {
  const el = /** @type {HTMLElement} */ (h("div", { class: "upd-notice is-available tel-notice", role: "status", "aria-live": "polite" }));
  el.hidden = true;
  if (viewOnly()) return { el };
  let busy = false;
  /** @param {boolean} off */
  const seen = async (off) => {
    if (busy) return;
    busy = true;
    try {
      await api("/telemetry/notice-seen", { method: "POST", body: off ? { off: true } : {} });
      el.hidden = true;
      if (off) onToast("Anonymous usage stats are off");
    } catch {
      onToast("That didn't save: try again", "err");
    } finally {
      busy = false;
    }
  };
  const icon = h("span", { class: "upd-ic", "aria-hidden": "true" });
  setHtml(icon, ICONS.info || ICONS.sparkles);
  el.replaceChildren(
    icon,
    h("div", { class: "upd-body" },
      h("div", { class: "upd-title" }, TELEMETRY_NOTICE.title),
      h("div", { class: "upd-sub" }, TELEMETRY_NOTICE.sub),
      h("div", { class: "upd-acts" },
        h("button", { class: "primary sm upd-go", type: "button", onclick: () => void seen(false) }, "OK"),
        h("button", { class: "ghost sm upd-later", type: "button", title: "Send nothing; Settings › Data and privacy turns it back on", onclick: () => void seen(true) }, "Turn off"))),
  );
  void Promise.resolve(api("/telemetry")).then((v) => {
    el.hidden = !noticeShows(v);
  }, () => {});
  return { el };
}
