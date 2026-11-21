// @ts-check
// Browser preferences (AgentPlanUX §5.10): everything that belongs to the browser rather than the
// shim — theme, font sizes, code presentation, notification switches, shortcut overrides. Backed by
// the shared store under `filament.harness.*` (the store prefixes `Filament.` itself, so the keys here
// pass `harness.<name>`). Values are typed against PREF_DEFAULTS: a stored raw is coerced to the
// default's type, and anything missing or unreadable falls back to the default. onChange hands back
// (key, value) and returns an unsubscribe.
import { store } from "../lib/store.js";

export const PREF_DEFAULTS = {
  // The system's light or dark until one is chosen (the owner's of 11-09: "make the theme default to system"); a theme
  // chosen is kept as it was stored. harness.html sets it before the first paint by the same rule.
  theme: "system",
  uiFontSize: 14,
  codeFontSize: 14,
  showReasoning: true,
  showTodos: true,
  groupExplore: true,
  groupTerminal: true,
  groupChanges: true,
  statusPanel: "composer",
  performanceMode: false,
  // A notification for each way a run ends while the tab is out of sight (HarnessV4_Settings_Plan HS-D73).
  notifyDone: false,
  notifyFailed: false,
  notifyAsks: false,
  notificationSound: true,
  // The composer's keys (HS-D70): "enter" sends with Enter, "ctrl-enter" with Ctrl+Enter (⌘+Enter); and what a
  // message does while the agent works: "steer" goes into the running turn, "wait" joins the chat's queue (HS-D72).
  sendKey: "enter",
  whileWorking: "steer",
  shortcuts: "{}",
  hintsSeen: "{}",
  // The welcome tour's step it was left on, by its name (views/welcome.js `stepAt`: a number an older Filament kept is the
  // place it had then); whether it was seen is the data folder's (`ui.welcome.seen`).
  welcomeStep: "",
  autoArchive: "off",
  // The Artifacts page's grid or list (HarnessV4_Artifacts_Plan AFC-12).
  artifactsLayout: "grid",
  // Overview's widgets as the person left them, one layout for every chat (proposal_ux §5.5): JSON, "{}" the default's.
  overviewLayout: "{}",
  // The team cards in a transcript folded to their head line (the owner's ask of 10-23): JSON, their keys, newest last.
  foldedMarks: "[]",
};

/** A boolean pref is stored as "on"/"off" (the older panels' spelling; "1"/"true" read back too). @param {string} raw */
const truthy = (raw) => raw === "on" || raw === "true" || raw === "1";

/** @param {any} value */
function serialize(value) {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "on" : "off";
  return JSON.stringify(value);
}

/** @param {string | null} raw @param {string | number | boolean | object} dflt */
function coerce(raw, dflt) {
  if (raw == null) return dflt;
  if (typeof dflt === "boolean") return truthy(raw);
  if (typeof dflt === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : dflt;
  }
  if (typeof dflt === "object") {
    try {
      const j = JSON.parse(raw);
      return j && typeof j === "object" ? j : dflt;
    } catch {
      return dflt;
    }
  }
  return raw;
}

const listeners = new Set();

export const prefs = {
  /** @param {string} key @returns {any} */
  get(key) {
    const dflt = PREF_DEFAULTS[key];
    return coerce(store.get(`harness.${key}`), dflt);
  },
  /** @param {string} key @param {any} value @returns {any} the value as stored */
  set(key, value) {
    const raw = serialize(value);
    store.set(`harness.${key}`, raw);
    const out = coerce(raw, PREF_DEFAULTS[key]);
    for (const fn of [...listeners]) fn(key, out);
    return out;
  },
  /** @param {(key: string, value: any) => void} fn @returns {() => void} */
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
