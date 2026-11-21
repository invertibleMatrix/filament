// @ts-check
// The tab title names the task and marks a live run; a run that
// ends while the tab is hidden raises a browser notification, and the sidebar row takes the unread dot.
// General's three switches gate the notification itself, one for each way a run ends (HarnessV4_Settings_Plan HS-D73).
// In the desktop app's window the app tells of every chat itself (its tray's Notifications, HarnessV3-Native NA3b):
// there the page tells nothing, so nothing is told twice.
import { state } from "./state.js";
import { prefs } from "./prefs.js";

/** The desktop app's window: Electron names itself in the page's user agent. */
export const inDesktopApp = () => typeof navigator !== "undefined" && /\bElectron\//.test(String(navigator.userAgent || ""));

/** The switch that says whether a run that ended this way notifies: it finished, it failed, or it needs your answer. */
export const NOTIFY_PREF = Object.freeze({ done: "notifyDone", error: "notifyFailed", paused: "notifyAsks", question: "notifyAsks" });

/** Whether a run that ended this way notifies. @param {string} status */
export const notifies = (status) => {
  const key = /** @type {Record<string, string>} */ (NOTIFY_PREF)[status];
  return !!key && prefs.get(key) === true;
};

const TITLES = {
  done: "Chat completed",
  paused: "Your confirmation is needed",
  question: "Your response is needed",
  error: "Chat error occurred",
};

/** A popped pane's window names its pane before its chat (HarnessV4_BrowserSize_Plan BS4). */
let titleLead = "";
/** @param {string} pane */
export const setTitleLead = (pane) => void (titleLead = pane ? `${pane} — ` : "");

/** @param {string} taskTitle @param {boolean} [live] */
export function setTabTitle(taskTitle, live = false) {
  const name = `${titleLead}${taskTitle || "Filament"}`;
  document.title = live ? `● ${name} — Filament` : `${name} — Filament`;
}

// A two-tone chime synthesized on the spot (WebAudio) — no sound file ships with the page and nothing is fetched.
/** @param {string} kind */
function chime(kind) {
  try {
    const Ctx = window.AudioContext || (/** @type {any} */ (window)).webkitAudioContext;
    const ctx = new Ctx();
    const down = kind === "error";
    const at = (freq, t0, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t0);
      osc.stop(ctx.currentTime + t0 + dur + 0.02);
    };
    at(down ? 392 : 659, 0, 0.18);
    at(down ? 262 : 880, 0.16, 0.22);
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

/**
 * A run ended: the unread dot while the tab is out of sight, and the notification its switch asks for.
 * @param {{ title: string, status: string, chainId?: string, onFocus?: () => void }} o
 */
export function notifyRunEnded(o) {
  if (o.chainId && document.hidden) state.unreadChains.add(o.chainId);
  if (!document.hidden || !notifies(o.status) || inDesktopApp()) return;
  if (prefs.get("notificationSound") !== false) chime(o.status);
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(/** @type {Record<string, string>} */ (TITLES)[o.status] || TITLES.done, { body: o.title });
    n.onclick = () => { window.focus(); o.onFocus?.(); n.close(); };
  } catch {}
}

/** Ask once for permission, the first time a run ends in the background — only while a switch wants notifications. */
export function ensureNotificationPermission() {
  if (inDesktopApp() || typeof Notification === "undefined" || Notification.permission !== "default") return;
  if (!Object.values(NOTIFY_PREF).some((key) => prefs.get(key) === true)) return;
  Notification.requestPermission().catch(() => {});
}
