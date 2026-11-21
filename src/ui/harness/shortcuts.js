// @ts-check
// The shortcut registry (AgentPlanUX §5.12): one table of defaults plus per-command overrides held in
// prefs (`shortcuts`, overrides only — a rebind that restores a default removes its override). The
// matcher requires modifiers to match exactly and never fires on key repeat or mid-IME. The Composer
// rows are display-only: the composer owns those keys and they cannot be rebound here.
import { prefs } from "./prefs.js";

/**
 * The desktop app's window, whose page gets every key a browser tab keeps for itself (desktop/main.js's menu holds only
 * reload, the developer tools, zoom and full screen) — as notify.js `inDesktopApp` tells it.
 */
const inApp = () => typeof navigator !== "undefined" && /\bElectron\//.test(String(navigator.userAgent || ""));

/**
 * `browser`: the default in a browser tab where `combo` is one the tab keeps for itself (`RESERVED`: the page never
 * gets it, and the recorder refuses it) — the desktop app keeps `combo` (the owner's settings cleanup of 11-09).
 * @type {{ id: string, label: string, combo: string, browser?: string, scope: "global" | "composer", rebindable?: boolean }[]}
 */
export const SHORTCUTS = [
  { id: "command-center", label: "Open Command Center", combo: "Ctrl+K", scope: "global" },
  { id: "command-center-alt", label: "Open Command Center", combo: "Ctrl+Shift+P", scope: "global" },
  { id: "settings", label: "Open Settings", combo: "Ctrl+,", scope: "global" },
  { id: "find", label: "Find in Chat", combo: "Ctrl+F", scope: "global" },
  { id: "sidebar", label: "Toggle Sidebar", combo: "Ctrl+B", scope: "global" },
  // The panes (proposal_ux §4.5): all of them shown or hidden, floated or docked, one opened or closed, the focus moved.
  { id: "pane", label: "Show or Hide Panes", combo: "Ctrl+Alt+B", scope: "global" },
  { id: "pane-float", label: "Float or Dock the Panes", combo: "Ctrl+Alt+F", scope: "global" },
  { id: "changes", label: "Open or Close Changes", combo: "Ctrl+Shift+D", scope: "global" },
  { id: "terminal", label: "Open or Close Terminal", combo: "Ctrl+J", scope: "global" },
  { id: "focus-next", label: "Focus the Next Part: Sidebar, Tab, Panes", combo: "F6", scope: "global" },
  { id: "focus-prev", label: "Focus the Previous Part", combo: "Shift+F6", scope: "global" },
  { id: "theme", label: "Toggle Light/Dark Theme", combo: "Ctrl+Shift+L", scope: "global" },
  // A browser tab opens a window on Ctrl+N: Ctrl+Shift+O there, as other chat apps' new chat.
  { id: "new-task", label: "New Chat", combo: "Ctrl+N", browser: "Ctrl+Shift+O", scope: "global" },
  // Now's first row (proposal_ux §4.1): the newest thing that needs you.
  { id: "next-needs", label: "Open What Needs You Next", combo: "Alt+N", scope: "global" },
  { id: "open-workspace", label: "Open Workspace", combo: "Ctrl+O", scope: "global" },
  // Not Ctrl+W: a normal browser tab reserves it — the page cannot intercept it, and the key would close the
  // window. Alt+W is the page's own key and does what the row says: the pane holding the focus, else the chat.
  { id: "close-context", label: "Close the Focused Pane, or the Chat", combo: "Alt+W", scope: "global" },
  { id: "zoom-in", label: "Zoom In", combo: "Ctrl+=", scope: "global" },
  { id: "zoom-out", label: "Zoom Out", combo: "Ctrl+-", scope: "global" },
  { id: "zoom-reset", label: "Reset Zoom", combo: "Ctrl+0", scope: "global" },
  { id: "model", label: "Open Model Menu", combo: "Ctrl+M", scope: "global" },
  { id: "mode", label: "Cycle Session Mode", combo: "Ctrl+Shift+M", scope: "global" },
  // A browser tab opens a tab on Ctrl+T: Alt+T there, beside the page's other Alt keys.
  { id: "effort", label: "Open Thought Levels", combo: "Ctrl+T", browser: "Alt+T", scope: "global" },
  // Not Ctrl+Shift+A: Chrome keeps it for its tab search.
  { id: "subagent", label: "Ask on the side", combo: "Alt+A", scope: "global" },
  { id: "fork", label: "Fork at this turn", combo: "Ctrl+Shift+F", scope: "global" },
  // The session's views (HarnessV3-Views VW-D1).
  { id: "view-chat", label: "Show Chat", combo: "Alt+1", scope: "global" },
  { id: "view-overview", label: "Show Overview", combo: "Alt+2", scope: "global" },
  { id: "view-side", label: "Show Agents", combo: "Alt+3", scope: "global" },
  { id: "view-team", label: "Show Team", combo: "Alt+4", scope: "global" },
  { id: "view-plan", label: "Show Plan", combo: "Alt+5", scope: "global" },
  { id: "task-prev", label: "Previous Chat", combo: "Ctrl+Shift+[", scope: "global" },
  { id: "task-next", label: "Next Chat", combo: "Ctrl+Shift+]", scope: "global" },
  { id: "back", label: "Navigate Back", combo: "Ctrl+[", scope: "global" },
  { id: "forward", label: "Navigate Forward", combo: "Ctrl+]", scope: "global" },
  { id: "composer-send", label: "Send Message", combo: "Enter", scope: "composer", rebindable: false },
  { id: "composer-newline", label: "Insert Newline in Composer", combo: "Shift+Enter", scope: "composer", rebindable: false },
  { id: "composer-veto", label: "Veto this round", combo: "Ctrl+Enter", scope: "composer", rebindable: false },
];

/** A shortcut's default where the page runs: its browser one in a tab, where it has one. @param {(typeof SHORTCUTS)[number]} s */
const defaultCombo = (s) => (!inApp() && s.browser) || s.combo;
const DEFAULTS = new Map(SHORTCUTS.map((s) => [s.id, defaultCombo(s)]));

/** The top row's digits by their key: `Digit2` is "2" whatever the layout or the modifier makes of it. */
const DIGITS = Object.fromEntries([..."0123456789"].map((d) => [`Digit${d}`, d]));

// A browser tab keeps some combinations for itself; recording one is refused with the reserved message.
const RESERVED = new Set([
  "Ctrl+T",
  "Ctrl+W",
  "Ctrl+N",
  "Ctrl+Shift+N",
  "Ctrl+Shift+T",
  "Ctrl+Shift+W",
  "Ctrl+Tab",
  "Ctrl+Shift+Tab",
  "Ctrl+PgUp",
  "Ctrl+PgDn",
]);

/** True when the browser reserves the combination for its own tab handling. @param {string} combo */
export function isReserved(combo) {
  return RESERVED.has(combo);
}

/** @returns {Record<string, string>} */
function overrides() {
  try {
    return JSON.parse(prefs.get("shortcuts") || "{}");
  } catch {
    return {};
  }
}

/** The composer's keys for each of General's Send with (HarnessV4_Settings_Plan HS-D70): with Ctrl+Enter, Enter makes
 *  the new line and Veto this round has no key — the ⌄ menu has it (HS-D71). */
const COMPOSER_KEYS = Object.freeze({
  enter: Object.freeze({ "composer-send": "Enter", "composer-newline": "Shift+Enter", "composer-veto": "Ctrl+Enter" }),
  "ctrl-enter": Object.freeze({ "composer-send": "Ctrl+Enter", "composer-newline": "Enter", "composer-veto": "" }),
});

/** The composer's keys as General's Send with sets them now. @returns {Readonly<Record<string, string>>} */
export function composerKeys() {
  return COMPOSER_KEYS[prefs.get("sendKey") === "ctrl-enter" ? "ctrl-enter" : "enter"];
}

/** The combo a shortcut currently answers to: the composer's from Send with, the others' override or default; "" for
 *  none. @param {string} id */
export function comboOf(id) {
  const own = composerKeys();
  if (id in own) return own[id];
  return overrides()[id] || DEFAULTS.get(id) || "";
}

/** Every shortcut with its effective combo; the editor table renders this. */
export function list() {
  return SHORTCUTS.map((s) => ({
    id: s.id,
    label: s.label,
    scope: s.scope,
    combo: comboOf(s.id),
    default: DEFAULTS.get(s.id) || "",
    rebindable: s.rebindable !== false,
  }));
}

/** The rebindable shortcuts a combo is taken by, newest definition first, `exceptId` left out. @param {string} combo @param {string} [exceptId] */
export function conflicts(combo, exceptId = "") {
  return list()
    .filter((s) => s.rebindable && s.id !== exceptId && s.combo === combo)
    .map((s) => s.id);
}

/** A key event as a combo string. Modifiers match exactly; repeats and IME composition never match. @param {KeyboardEvent} e */
export function comboFromEvent(e) {
  if (e.repeat || e.isComposing) return "";
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  // `key` is the shifted character, so "[" arrives as "{" — and on a Mac Option+2 arrives as "™". The physical key is
  // the stable one for those.
  const named = { BracketLeft: "[", BracketRight: "]", Comma: ",", Equal: "=", Minus: "-", Enter: "Enter", Escape: "Esc", Backspace: "Backspace", Tab: "Tab", ...DIGITS };
  const key = named[e.code] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";
  parts.push(key);
  return parts.join("+");
}

/** A combo that types or moves the caret in a field: no Ctrl or Alt held, and no function key. @param {string} combo */
const typesInField = (combo) => !/^(?:Ctrl|Alt)\+/.test(combo) && !/^(?:Shift\+)?F\d{1,2}$/.test(combo);
/** Whether the person types where the event lands: a field, a box, a list to pick from, an editable part. @param {any} t */
const typingIn = (t) => !!t && (/^(?:INPUT|TEXTAREA|SELECT)$/.test(String(t.tagName || "")) || t.isContentEditable === true);

/**
 * The shortcut id an event matches, or "". Every default holds Ctrl or Alt, or is a function key, and answers in the
 * message box too (Ctrl+K from where you type); a combo a rebind made of a key that types — a letter, `/`, Enter — is
 * the field's while the person types in one, and the command's elsewhere. @param {KeyboardEvent} e
 * @param {"global" | "composer"} [scope]
 */
export function matchShortcut(e, scope = "global") {
  const combo = comboFromEvent(e);
  if (!combo) return "";
  if (typesInField(combo) && typingIn(e.target)) return "";
  const hit = list().find((s) => s.scope === scope && s.rebindable && s.combo === combo);
  return hit?.id || "";
}

/**
 * Rebind one shortcut. An override is recorded only when it differs from the default; a combo another
 * command holds is stolen (that command falls back to its default). @param {string} id @param {string} combo
 */
export function rebind(id, combo) {
  const def = SHORTCUTS.find((s) => s.id === id);
  if (!def || def.rebindable === false || !combo) return false;
  const all = overrides();
  if (combo === DEFAULTS.get(id)) delete all[id];
  else all[id] = combo;
  prefs.set("shortcuts", JSON.stringify(all));
  return true;
}

/** Clear every override. */
export function reset() {
  prefs.set("shortcuts", "{}");
}

export { reset as resetShortcuts };

/** A combo as the platform prints it: Ctrl+K on Windows/Linux, ⌘K on mac. @param {string} combo @param {boolean} [mac] */
export function comboLabel(combo, mac = false) {
  if (!mac) return combo;
  const keys = combo.split("+");
  const key = keys.pop() || "";
  const mods = keys.map((m) => (m === "Ctrl" ? "⌘" : m === "Shift" ? "⇧" : m === "Alt" ? "⌥" : m));
  return mods.join("") + key;
}
