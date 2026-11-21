// @ts-check
// The desktop app's update, at the sidebar's foot (the owner's of 11-07: a small notice in Filament itself — pressed,
// the update downloads while the person works, and it installs once they say so): a newer Filament out, its download
// under way, ready to restart into, or a download that failed and why; a store's build opens its store, and one that
// can't update itself its release's page. It hears the app through its window's bridge (desktop/harness-preload.cjs
// `filamentApp.update`, `onUpdate`, `updateAct`): a browser, a checkout's app, or an app attached to a Filament it did
// not start shows none. Later hides it for this version until where it stands moves.
import { h, setHtml } from "../../lib/dom.js";
import { ICONS } from "./icons.js";

/** What a store's build updates from, by its kind (desktop/lib/updates.js). @type {Record<string, string>} */
const STORES = { "mac-store": "the App Store", "windows-store": "the Microsoft Store" };

/** Bytes as megabytes, for the download's line. @param {number} n */
const mb = (n) => `${Math.max(0, Math.round((Number(n) || 0) / 1e6))} MB`;
/** Why a download failed, on one line of 120 characters at most. @param {unknown} s */
const whyLine = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
};

/**
 * What the notice says for where the update stands (desktop/lib/updates.js UpdateState): its line, the line under it,
 * its button and what that asks the app, its icon, and the download's share; null for nothing to say.
 * @param {any} s
 * @returns {{ phase: string, title: string, sub: string, button: { label: string, act: "get" | "restart" } | null, icon: "download" | "sparkles" | "refreshCw", progress: number | null } | null}
 */
export function noticeOf(s) {
  if (!s || typeof s.version !== "string" || !s.version || !s.phase || s.phase === "none") return null;
  const v = s.version;
  if (s.phase === "ready")
    return { phase: "ready", title: `Filament ${v} is ready`, sub: "Filament restarts to install it. If a chat is working, you're asked first.", button: { label: "Restart to update", act: "restart" }, icon: "sparkles", progress: null };
  if (s.phase === "downloading") {
    const share = s.size > 0 ? Math.min(1, Math.max(0, s.received / s.size)) : null;
    return { phase: "downloading", title: `Downloading Filament ${v}…`, sub: share === null ? `${mb(s.received)} so far` : `${Math.floor(share * 100)}% of ${mb(s.size)}`, button: null, icon: "download", progress: share };
  }
  if (s.phase === "failed") {
    const why = whyLine(s.why);
    return { phase: "failed", title: `Filament ${v} didn't download`, sub: why ? `${why[0].toUpperCase()}${why.slice(1)}.`.replace(/\.\.$/, ".") : "The download failed.", button: { label: "Try again", act: "get" }, icon: "refreshCw", progress: null };
  }
  if (STORES[s.kind]) return { phase: "available", title: `Filament ${v} is out`, sub: `${STORES[s.kind][0].toUpperCase()}${STORES[s.kind].slice(1)} updates it.`, button: { label: `Open ${STORES[s.kind]}`, act: "get" }, icon: "download", progress: null };
  if (s.kind === "page") return { phase: "available", title: `Filament ${v} is out`, sub: "Its release page has it to install.", button: { label: "See the release", act: "get" }, icon: "download", progress: null };
  return { phase: "available", title: `Filament ${v} is out`, sub: "It downloads while you work, then asks before it installs.", button: { label: "Update", act: "get" }, icon: "download", progress: null };
}

/**
 * The notice: hidden until the app offers an update, painted as each move of it comes.
 * @param {{ app?: any, later?: { get: () => string, set: (key: string) => void } }} [o]
 *   `app`: the window's bridge (the page's `filamentApp` unless given); `later`: where Later is kept (the tab's session)
 * @returns {{ el: HTMLElement, paint: (s: any) => void }}
 */
export function updateNotice({ app = /** @type {any} */ (globalThis).filamentApp, later = sessionLater() } = {}) {
  const el = /** @type {HTMLElement} */ (h("div", { class: "upd-notice", role: "status", "aria-live": "polite" }));
  el.hidden = true;
  if (typeof app?.update !== "function" || typeof app?.updateAct !== "function") return { el, paint: () => {} };
  let busy = false;
  /** @type {string} */
  let shown = "";
  /** @param {any} s */
  const paint = (s) => {
    const n = noticeOf(s);
    const key = n ? `${s.version}:${n.phase}` : "";
    el.hidden = !n || later.get() === key;
    if (!n || el.hidden) return void (shown = "");
    el.className = `upd-notice is-${n.phase}`;
    // A download's progress moves the bar and its line alone; anything else is drawn anew.
    const bar = /** @type {HTMLElement | null} */ (el.querySelector(".upd-bar span"));
    if (shown === key && n.phase === "downloading" && bar) {
      bar.style.width = `${Math.round((n.progress ?? 0) * 100)}%`;
      const sub = el.querySelector(".upd-sub");
      if (sub) sub.textContent = n.sub;
      return;
    }
    shown = key;
    const icon = h("span", { class: "upd-ic", "aria-hidden": "true" });
    setHtml(icon, ICONS[n.icon]);
    const acts = h("div", { class: "upd-acts" });
    if (n.button) {
      const b = n.button;
      acts.append(
        h("button", {
          class: "primary sm upd-go",
          type: "button",
          onclick: async () => {
            if (busy) return;
            busy = true;
            try {
              await app.updateAct(b.act);
            } catch {
            } finally {
              busy = false;
            }
          },
        }, b.label),
      );
    }
    acts.append(h("button", { class: "ghost sm upd-later", type: "button", title: "Hide this until it moves on", onclick: () => (later.set(key), paint(s)) }, "Later"));
    el.replaceChildren(
      icon,
      h("div", { class: "upd-body" },
        h("div", { class: "upd-title" }, n.title),
        h("div", { class: "upd-sub" }, n.sub),
        ...(n.phase === "downloading" ? [h("div", { class: "upd-bar", "aria-hidden": "true" }, h("span", { style: `width: ${Math.round((n.progress ?? 0) * 100)}%` }))] : []),
        acts),
    );
  };
  void Promise.resolve(app.update()).then(paint, () => {});
  app.onUpdate?.(paint);
  return { el, paint };
}

/** Later, kept for the tab's session: one version and where it stood. */
function sessionLater() {
  const KEY = "filament.updateLater";
  return {
    get: () => {
      try {
        return sessionStorage.getItem(KEY) || "";
      } catch {
        return "";
      }
    },
    set: (/** @type {string} */ key) => {
      try {
        sessionStorage.setItem(KEY, key);
      } catch {}
    },
  };
}
