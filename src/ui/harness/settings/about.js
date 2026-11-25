// @ts-check
// Settings › About (HarnessV4_Settings_Plan HS-4): which Filament this is and how long it has run (its data folder is
// Data and privacy's, the owner's of 11-09);
// Restart Filament, which cuts nothing: refused while a turn runs, naming the chat (HC-65), and where nothing would start
// Filament again (the desktop app did not start it) it says so before it acts and asks first (HC-66); the console, for the proxy's own
// tools and every request's record (Records, which this page took in, HS-D5). In the desktop app, Updates' Check now.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { confirmDialog } from "../lib/ui.js";
import { mountConfigPage } from "../lib/config-rows.js";
import { noticeOf } from "../lib/update-notice.js";

/** Settings search's words for this page (search.js, HS-D68): each row it draws, checked against its code by a test.
 *  The restart's row is named by what stops Filament on this machine (`restartWords`). */
export const SEARCH_ROWS = Object.freeze([
  { label: "Version" },
  { label: "Updates", words: "check for updates new version upgrade" },
  { label: "Running for", words: "uptime" },
  { label: "Restart Filament", also: ["Stop Filament"] },
  { label: "Open the console", words: "dashboard" },
  { label: "Records", words: "requests log" },
]);

/** How long, in hours and minutes or days and hours. @param {number} ms */
export function uptimeWords(ms) {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} h ${min % 60} min`;
  return `${Math.floor(hrs / 24)} d ${hrs % 24} h`;
}

/**
 * The Restart row's words: what a stop does, as the server says what starts Filament again (`supervisor`) and the
 * system it runs on (`os`, its state's: a service's runner is a Mac's launchd there, else a Windows host's task).
 * @param {string | null} supervisor @param {string} [os]
 */
export function restartWords(supervisor, os = "") {
  // The desktop app (HarnessV3-Native NA2) and a service (filament service install: systemd's unit, a Windows host's
  // scheduled task, or a Mac's launchd) start Filament again after a stop; nothing else does.
  const runner = /^mac/i.test(os) ? "launchd" : "its scheduled task";
  const by = supervisor === "desktop" ? "the Filament app" : supervisor === "systemd" ? "systemd" : supervisor === "service" ? runner : "";
  return by
    ? { label: "Restart Filament", button: "Restart Filament", desc: `Filament stops and ${by} starts it again, in a few seconds. Refused while a turn runs, so nothing is cut.` }
    : { label: "Stop Filament", button: "Stop Filament", desc: "This stops Filament; start it again yourself: nothing on this machine starts it after a stop (the Filament app did not start it). Refused while a turn runs." };
}

/** The Updates row's words before Check now: the looks the app makes by itself (desktop/lib/updates.js). */
export const UPDATES_DESC = "Filament also looks by itself a minute after it starts and every six hours, unless Check for updates is off in the tray's menu.";

/**
 * What Check now found, in the row's words (desktop/lib/updates.js `Looked`; `checkout` and `attached` the app's own).
 * @param {any} r
 */
export function checkedWords(r) {
  const why = String(r?.why ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  if (r?.result === "newest") return `Filament ${r.version} is the newest version.`;
  if (r?.result === "out") return `Filament ${r.version} is out.`;
  if (r?.result === "none") return `No update to take: ${why || "the newest release has none for this system"}.`;
  if (r?.result === "failed") return `Couldn't check: ${why || "GitHub didn't answer"}.`;
  if (r?.result === "checkout") return "This Filament runs from its code folder: it updates with git pull.";
  if (r?.result === "attached") return "This app shows a Filament started elsewhere, so it offers no update while that one runs.";
  return "Couldn't check: the app didn't answer.";
}

/**
 * Settings › About's Updates row, in the desktop app alone (the owner's of 11-08): Check now looks for a newer Filament
 * at once, rather than at the app's next look by itself, and says what it found. Where the app offers one, the row says
 * where it stands and its button is the sidebar notice's next step (lib/update-notice.js `noticeOf`): Update, Restart to
 * update, Try again; a download shows its share. Null where the window has no bridge (a browser, another machine's page).
 * @param {any} app  the window's bridge (desktop/harness-preload.cjs `filamentApp`) @param {typeof h} m
 * @param {() => boolean} [alive]  whether the page is still shown: once not, the row stops hearing the app
 * @returns {{ desc: any, button: any } | null}
 */
export function updatesRow(app, m, alive = () => true) {
  if (typeof app?.checkUpdates !== "function") return null;
  // What Check now found is read out as it comes; an offer's words are the sidebar notice's, read out there, so a
  // download's share is not read at each percent.
  const live = m("span", { role: "status", "aria-live": "polite" }, UPDATES_DESC);
  const offer = m("span", {});
  const desc = m("span", {}, live, offer);
  /** @type {any} */
  let state = null;
  let checking = false;
  let said = "";
  /** @param {any} el @param {string} text */
  const put = (el, text) => (text ? el.replaceChildren(text) : el.replaceChildren());
  const paint = () => {
    const n = noticeOf(state);
    put(live, n ? "" : said || UPDATES_DESC);
    put(offer, n ? `${n.title}${n.title.endsWith("…") ? "" : "."} ${n.sub}` : "");
    button.replaceChildren(n ? (n.button?.label ?? "Downloading…") : checking ? "Checking…" : "Check now");
    // Unavailable while it checks or downloads, yet kept focused: a press then does nothing.
    button.setAttribute("aria-disabled", String(checking || (!!n && !n.button)));
    // The next step stands out, as the notice's does.
    button.classList.toggle("primary", !!n?.button);
    button.classList.toggle("ghost", !n?.button);
  };
  const press = async () => {
    const n = noticeOf(state);
    if (checking || (n && !n.button)) return;
    if (n?.button) return void (await Promise.resolve(app.updateAct?.(n.button.act)).catch(() => {}));
    checking = true;
    paint();
    said = checkedWords(await Promise.resolve(app.checkUpdates()).catch(() => null));
    checking = false;
    paint();
  };
  const button = m("button", { class: "ghost sm", type: "button", "aria-disabled": "false", onclick: () => void press() }, "Check now");
  /** @param {any} s */
  const heard = (s) => {
    // An offer gone (a release pulled): what an earlier Check now found is past.
    if (noticeOf(state) && !noticeOf(s)) said = "";
    state = s;
    paint();
  };
  void Promise.resolve(app.update?.()).then(heard, () => {});
  /** @type {any} */
  const off = app.onUpdate?.((/** @type {any} */ s) => (alive() ? heard(s) : void off?.()));
  return { desc, button };
}

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, confirm?: typeof confirmDialog, app?: any }} [io]
 */
export function renderAbout(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const ask = io.confirm || confirmDialog;
  const toast = cb.onToast || (() => {});
  // Made once, kept through the page's redraws: what Check now found stays said.
  const updates = updatesRow(io.app ?? /** @type {any} */ (globalThis).filamentApp, m, () => body.isConnected !== false);

  /** The stop, asked first where nothing starts Filament again. @param {string | null} supervisor */
  const restart = async (supervisor) => {
    const again = restartWords(supervisor).label === "Restart Filament";
    if (!again && !(await ask({ title: "Stop Filament?", description: restartWords(supervisor).desc, confirmLabel: "Stop Filament", destructive: true }))) return;
    try {
      await call("/shutdown", { method: "POST", body: { ifIdle: true } });
      toast(again ? "Restarting Filament: back in a few seconds" : "Filament is stopping");
    } catch (/** @type {any} */ e) {
      const note = String(e?.body?.note || e?.body?.error || e?.message || e).replace(/^not stopped: /, "");
      toast(`Not ${again ? "restarted" : "stopped"}: ${note}. Try again once it ends.`, "err");
    }
  };

  mountConfigPage(body, cb, { ...io, api: call }, {
    rows: (kit) => {
      const s = kit.state;
      const words = restartWords(s.supervisor ?? null, String(s.system?.os || ""));
      return [
        kit.row("Version", "", m("code", { class: "cset-code" }, String(s.version || "?"))),
        updates && kit.row("Updates", updates.desc, updates.button),
        kit.row("Running for", "", m("span", { class: "cset-plain" }, uptimeWords(Number(s.uptimeMs) || 0))),
        kit.head("Running Filament"),
        kit.row(words.label, words.desc, m("button", { class: `ghost sm${words.label === "Restart Filament" ? "" : " danger"}`, type: "button", onclick: () => void restart(s.supervisor ?? null) }, words.button)),
        kit.head("The console"),
        kit.row("Open the console", "The proxy's own tools: traffic, routes beyond backups, rules for outside apps, templates.", m("a", { class: "ghost sm", href: "/ui/", target: "_blank", rel: "noopener" }, "Open the console")),
        kit.row("Records", "Every request's record and the operations log.", m("a", { class: "ghost sm", href: "/ui/#requests", target: "_blank", rel: "noopener" }, "Open Records")),
      ].filter(Boolean);
    },
  });
}
