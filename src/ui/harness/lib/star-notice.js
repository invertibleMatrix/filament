// @ts-check
// The ask for a star at the sidebar's foot, beside the update's (the owner's of 11-22: shown after a few hours of
// using Filament): `GET /star` says whether it asks now (http/admin/star.js — never once asked, nor while the usage-stats
// notice waits), looked at as the page opens and each hour after while it has not asked; never on a view-only
// device's page. Star on GitHub opens the repository in the browser; it and Not now say it was asked (`POST
// /star/seen`), and it never asks again.
import { h, setHtml } from "../../lib/dom.js";
import { ICONS } from "./icons.js";

/** The card's words. */
export const STAR_NOTICE = Object.freeze({
  title: "Enjoying Filament?",
  sub: "A star on GitHub helps other developers find it.",
});

/** How often it looks again while it has not asked. */
export const STAR_LOOK_MS = 3600_000;

/** Whether the card shows for what `GET /star` answered. @param {any} v */
export const starShows = (v) => !!v && v.asks === true && typeof v.url === "string" && /^https:\/\//.test(v.url);

/**
 * @param {{ api: (path: string, o?: any) => Promise<any>, viewOnly?: () => boolean, open?: (url: string) => void,
 *   every?: (f: () => void, ms: number) => any, stopEvery?: (t: any) => void }} o
 *   `open`: opens an address in the browser (a new window, which the desktop app hands to the system's); `every` and
 *   `stopEvery`: the hourly look's timer, which never keeps a process alive by itself (a page built in node, a test's)
 * @returns {{ el: HTMLElement, look: () => Promise<void> }}
 */
export function starNotice({
  api,
  viewOnly = () => false,
  open = (url) => void window.open(url, "_blank", "noopener,noreferrer"),
  every = (f, ms) => {
    const t = setInterval(f, ms);
    /** @type {any} */ (t)?.unref?.();
    return t;
  },
  stopEvery = (t) => clearInterval(t),
}) {
  const el = /** @type {HTMLElement} */ (h("div", { class: "upd-notice is-available star-notice", role: "status", "aria-live": "polite" }));
  el.hidden = true;
  if (viewOnly()) return { el, look: async () => {} };
  let url = "";
  let done = false;
  /** @type {any} */
  let timer = null;
  const end = () => {
    done = true;
    el.hidden = true;
    if (timer !== null) stopEvery(timer), (timer = null);
  };
  /** @param {boolean} star */
  const seen = (star) => {
    if (star && url) open(url);
    end();
    void Promise.resolve(api("/star/seen", { method: "POST", body: {} })).catch(() => {});
  };
  const icon = h("span", { class: "upd-ic", "aria-hidden": "true" });
  setHtml(icon, ICONS.star || ICONS.sparkles);
  el.replaceChildren(
    icon,
    h("div", { class: "upd-body" },
      h("div", { class: "upd-title" }, STAR_NOTICE.title),
      h("div", { class: "upd-sub" }, STAR_NOTICE.sub),
      h("div", { class: "upd-acts" },
        h("button", { class: "primary sm upd-go", type: "button", onclick: () => seen(true) }, "Star on GitHub"),
        h("button", { class: "ghost sm upd-later", type: "button", title: "It won't ask again", onclick: () => seen(false) }, "Not now"))),
  );
  const look = async () => {
    if (done) return;
    try {
      const v = await api("/star");
      if (done) return;
      if (v?.asked === true) return end();
      if (!starShows(v)) return;
      url = v.url;
      el.hidden = false;
      if (timer !== null) stopEvery(timer), (timer = null);
    } catch {}
  };
  void look();
  timer = every(() => void look(), STAR_LOOK_MS);
  return { el, look };
}
