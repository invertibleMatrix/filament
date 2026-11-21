// @ts-check
// The General section (§5.10): the welcome tour, opened again (the owner's of 11-05: hard to find again from the command
// center alone); the notification switches — one for each way a run ends while the tab is out of sight
// (HarnessV4_Settings_Plan HS-D73) — and their sound, or in the desktop app's window the app's own Notifications switch
// (HarnessV3-Native NA3b; the tray's check, asked of the app since the design pass of 10-24, UX8 — an app too old to
// answer gets the words that point at its tray); the message box's keys and what a message does while the agent
// works (HS-D70 to HS-D72); and B6's auto-archive — a select of retention options; when on, a sweep archives
// finished, unread-free, unpinned tasks older than the window and says how many it archived (never silently). The
// sweep runs as the harness app starts and once an hour after, Settings open or not (app.js `startHourlySweep`, the
// owner's settings cleanup of 11-09). And New chats start on (new-chat-model.js), the model a new chat starts with (the
// same cleanup).
import { h } from "../../lib/dom.js";
import { api, readEvery } from "../lib/api.js";
import { prefs } from "../prefs.js";
import { inDesktopApp } from "../notify.js";
import { button } from "../lib/ui.js";
import { row, switchControl, selectControl, segmented } from "./rows.js";
import { NEW_CHAT_ROW, newChatModelCard } from "./new-chat-model.js";

const ARCHIVE_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "3", label: "Archive after 3 days" },
  { value: "7", label: "Archive after 7 days" },
  { value: "14", label: "Archive after 14 days" },
  { value: "30", label: "Archive after 30 days" },
];

/** The three notification switches: their pref, row and words. */
export const NOTIFY_ROWS = Object.freeze([
  { key: "notifyDone", label: "When a chat finishes", desc: "A notification when a chat's turn ends while this tab is out of sight." },
  { key: "notifyFailed", label: "When a chat fails", desc: "A notification when a chat's turn ends in an error while this tab is out of sight." },
  { key: "notifyAsks", label: "When a chat needs your answer", desc: "A notification when a chat stops to ask you something, or waits for your yes, while this tab is out of sight." },
]);
/** What General says in the desktop app's window, in the switches' place: the app tells, the page does not. */
export const APP_WORDS = "In the desktop app, the app itself tells you when a chat needs you, stops on an error, or finishes a long turn — any chat, in any project, while you are not in the harness. Turn it on or off with Notifications in the tray icon's menu.";
/** The desktop app's own switch, in the switches' place where its window can ask it (the design pass of 10-24, UX8). */
export const APP_SWITCH = Object.freeze({
  label: "Notifications",
  desc: "The app tells you when a chat needs you, stops on an error, or finishes a long turn — any chat, in any project, while you are not in the harness. The tray icon's menu has the same switch.",
});
/** What the switch says where the app did not answer. */
export const APP_SILENT = "The app did not answer: the tray icon's menu has the same switch.";

/**
 * The desktop app's own Notifications through its window's bridge (desktop/harness-preload.cjs `filamentApp`): the
 * choice, made first where one is named. Null in a browser, or in an app with no such bridge.
 * @returns {((on?: boolean) => Promise<boolean | null>) | null}
 */
export const appNotify = () => {
  const app = /** @type {any} */ (globalThis).filamentApp;
  return typeof app?.notify === "function" ? (on) => app.notify(on) : null;
};

/**
 * The desktop app's Notifications as a switch — the tray's check —, read from the app as it is drawn and set through
 * it; held still until the app answers, and said where it does not. @param {(on?: boolean) => Promise<boolean | null>} ask
 */
export function appSwitch(ask) {
  const sw = switchControl({ checked: false, disabled: true, label: APP_SWITCH.label, onChange: (on) => { sw.setAttribute("disabled", ""); void ask(on).then(paint, () => paint(null)); } });
  /** The app's answer on the switch. @param {boolean | null} on */
  const paint = (on) => {
    const known = typeof on === "boolean";
    sw.classList.toggle("on", on === true);
    sw.setAttribute("aria-checked", on === true ? "true" : "false");
    if (known) sw.removeAttribute("disabled");
    else sw.setAttribute("disabled", "");
    sw.title = known ? "" : APP_SILENT;
  };
  void ask().then(paint, () => paint(null));
  return row(APP_SWITCH.label, APP_SWITCH.desc, sw);
}
/** What General says while the browser refuses Filament's notifications. */
export const BLOCKED_WORDS = "This browser blocks Filament's notifications: allow them in its site settings for this address.";

/** The words each control of General is found by in Settings' search (HS-D68): its rows, as drawn below. */
export const SEARCH_ROWS = Object.freeze([
  { label: "Welcome tour", desc: "Filament's first steps again — your accounts, the model new chats start on, what the agent may do, memory, where you work — at the step you left it on." },
  { label: NEW_CHAT_ROW, words: "model new chat default" },
  ...NOTIFY_ROWS.map((r) => ({ label: r.label, desc: r.desc })),
  { label: "Notification sound", desc: "A chime with each notification you have switched on." },
  { label: "Send with", desc: "Enter sends and Shift+Enter makes a new line; or Ctrl+Enter (⌘+Enter) sends and Enter makes a new line." },
  { label: "A message while the agent works", desc: "Send at its next step: it goes into the running turn, which reads it once its current step is done. Send when it's done: it joins the chat's queue and goes when the turn ends. A message to an agent (@) and /btw go at once either way." },
  { label: "Auto-archive old chats", desc: "A chat becomes eligible for auto-archive only after its last update is older than this window." },
]);

/** A row's description as SEARCH_ROWS has it. @param {string} label */
const descOf = (label) => {
  const r = SEARCH_ROWS.find((x) => x.label === label);
  return (r && "desc" in r && r.desc) || "";
};

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, onWelcome?: () => void }} [cb]  `onWelcome`: the welcome tour,
 *   opened over the page (app.js `openTour`)
 * @param {Parameters<typeof newChatModelCard>[1]} [io]  New chats start on's admin API, picker and preference (a test's
 *   stand-ins)
 */
export function renderGeneral(body, cb = {}, io = {}) {
  const blocked = h("p", { class: "nset-note is-warn hidden" }, BLOCKED_WORDS);
  const sayBlocked = () => blocked.classList.toggle("hidden", !(typeof Notification !== "undefined" && Notification.permission === "denied" && NOTIFY_ROWS.some((r) => prefs.get(r.key) === true)));
  const notify = NOTIFY_ROWS.map((r) =>
    row(r.label, r.desc, switchControl({
      checked: prefs.get(r.key) === true,
      label: r.label,
      onChange: (on) => {
        prefs.set(r.key, on);
        // The browser asks once, when a notification is first wanted (HC-121).
        if (on && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().then(sayBlocked, () => {});
        sayBlocked();
      },
    })));
  const sound = switchControl({
    checked: prefs.get("notificationSound") === true,
    label: "Notification sound",
    onChange: (on) => prefs.set("notificationSound", on),
  });
  const sendKey = segmented({
    value: prefs.get("sendKey") === "ctrl-enter" ? "ctrl-enter" : "enter",
    options: [{ value: "enter", label: "Enter" }, { value: "ctrl-enter", label: "Ctrl+Enter" }],
    onChange: (v) => prefs.set("sendKey", v),
  });
  sendKey.el.setAttribute("aria-label", "Send with");
  const whileWorking = segmented({
    value: prefs.get("whileWorking") === "wait" ? "wait" : "steer",
    // Named as the send menu's rows are (the owner's of 11-09).
    options: [{ value: "steer", label: "Send at its next step" }, { value: "wait", label: "Send when it's done" }],
    onChange: (v) => prefs.set("whileWorking", v),
  });
  whileWorking.el.setAttribute("aria-label", "A message while the agent works");
  const archive = selectControl({
    value: String(prefs.get("autoArchive") || "off"),
    options: ARCHIVE_OPTIONS,
    label: "Auto-archive old chats",
    onChange: (v) => {
      prefs.set("autoArchive", v);
      if (v !== "off") autoArchiveSweep(cb);
    },
  });
  sayBlocked();
  const app = appNotify();
  body.replaceChildren(
    h("h3", { class: "nset-h" }, "Getting started"),
    row("Welcome tour", descOf("Welcome tour"), button({ label: "Open the tour", variant: "outline", size: "sm", onClick: () => cb.onWelcome?.() })),
    // Where new chats start, a preference of this browser's (the owner's settings cleanup of 11-09).
    h("h3", { class: "nset-h" }, "New chats"),
    newChatModelCard(cb, io).el,
    h("h3", { class: "nset-h" }, "Notifications"),
    ...(inDesktopApp()
      ? [app ? appSwitch(app) : h("p", { class: "nset-note" }, APP_WORDS)]
      : [...notify, blocked, row("Notification sound", descOf("Notification sound"), sound)]),
    h("h3", { class: "nset-h" }, "The message box"),
    row("Send with", descOf("Send with"), sendKey.el),
    row("A message while the agent works", descOf("A message while the agent works"), whileWorking.el),
    h("h3", { class: "nset-h" }, "Old chats"),
    row("Auto-archive old chats", descOf("Auto-archive old chats"), archive),
  );
}

/**
 * The sessions the window would archive: finished-of-interest means unpinned, unread-free, not already
 * archived, and last updated before `cutoff`. Pure.
 * @param {{ pinned?: boolean, unread?: boolean, archived?: boolean, when?: string }[]} sessions
 * @param {number} days @param {number} now
 * @returns {number[]}
 */
export function autoArchiveCandidates(sessions, days, now) {
  const cutoff = now - days * 86400_000;
  return sessions
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => {
      if (s.pinned || s.unread || s.archived) return false;
      const t = Date.parse(s.when || "");
      return Number.isFinite(t) && t < cutoff;
    })
    .map(({ i }) => i);
}

/**
 * What a sweep says: how many it archived, and how many it could not, with the first one's why; nothing when it had
 * nothing to archive. @param {number} archived @param {string[]} failed  each failure's words
 * @returns {{ text: string, kind: string } | null}
 */
export function sweepWords(archived, failed) {
  const chats = (/** @type {number} */ n) => `${n} old chat${n === 1 ? "" : "s"}`;
  if (!failed.length) return archived ? { text: `Auto-archived ${chats(archived)}`, kind: "" } : null;
  const why = failed[0];
  return archived
    ? { text: `Auto-archived ${chats(archived)}; ${failed.length} more could not be: ${why}`, kind: "err" }
    : { text: `Auto-archive could not archive ${chats(failed.length)}: ${why}`, kind: "err" };
}

let sweeping = false;
let lastSweepAt = 0;

/**
 * One sweep: every chat the list holds read, a page at a time, the ones the retention window names archived, and the
 * count toasted — with what could not be archived, or a list that could not be read, in an error's toast. Runs at most
 * once a minute however many callers race. @param {{ onToast?: (msg: string, kind?: string) => void }} [cb]
 * @param {{ api?: (path: string, o?: any) => Promise<any>, now?: () => number }} [io]  the admin API and the clock (a
 *   test's stand-ins)
 */
export async function autoArchiveSweep(cb = {}, io = {}) {
  const call = io.api || api;
  const now = io.now || Date.now;
  const days = Number(prefs.get("autoArchive"));
  if (!days || sweeping || now() - lastSweepAt < 60_000) return;
  sweeping = true;
  lastSweepAt = now();
  try {
    /** @type {any[]} */
    let sessions;
    try {
      sessions = await readEvery("/memory/sessions", "sessions", { read: call });
    } catch (e) {
      cb.onToast?.(`Auto-archive could not read your chats: ${String(/** @type {any} */ (e)?.message || e)}`, "err");
      return;
    }
    const stale = autoArchiveCandidates(sessions, days, now());
    let n = 0;
    /** @type {string[]} */
    const failed = [];
    for (const i of stale) {
      const s = sessions[i];
      if (!s?.id) continue;
      try {
        await call(`/sessions/${encodeURIComponent(s.id)}/settings`, { method: "PATCH", body: { patch: { display: { archived: true } } } });
        n++;
      } catch (e) {
        failed.push(String(/** @type {any} */ (e)?.message || e));
      }
    }
    const said = sweepWords(n, failed);
    if (said) cb.onToast?.(said.text, said.kind);
  } finally {
    sweeping = false;
  }
}

/**
 * The sweep as the harness app starts and once an hour after, whether or not Settings is open, so a window picked once
 * archives without Settings being opened again (the owner's settings cleanup of 11-09). App.js starts it once per page
 * load; the window stays this browser's.
 * @param {{ onToast?: (msg: string, kind?: string) => void }} [cb]
 * @param {{ api?: (path: string, o?: any) => Promise<any>, now?: () => number }} [io]  as `autoArchiveSweep` takes them
 */
export function startHourlySweep(cb = {}, io = {}) {
  void autoArchiveSweep(cb, io);
  const id = setInterval(() => void autoArchiveSweep(cb, io), 3600_000);
  return () => clearInterval(id);
}
