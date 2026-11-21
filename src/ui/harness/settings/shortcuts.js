// @ts-check
// The Keyboard shortcuts section (§5.12): the table (Command · Keybinding · Scope · Actions), "Search
// shortcuts", the press-a-combination recorder, per-row Rebind with the conflict and browser-reserved
// messages, and Reset all to defaults. Overrides live in the `shortcuts` pref through the registry.
import { h } from "../../lib/dom.js";
import { button, confirmDialog, tooltip } from "../lib/ui.js";
import { list, rebind, reset, conflicts, comboFromEvent, comboLabel, isReserved } from "../shortcuts.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";

/** @param {HTMLElement} body */
// The recorder of the previous render: a section switch re-renders into the same connected body, so the
// self-check alone would not retire the old listener — this does.
let retire = null;
export function renderShortcuts(body) {
  retire?.();
  const mac = /mac/i.test(navigator.platform || "");
  /** @type {string | null} */ let search = null; // a recorded combination filtering the table
  let query = ""; // the text filter
  /** @type {string | null} */ let recording = null; // the id being rebound, or "search"
  /** @type {{ id: string, combo: string } | null} */ let pending = null; // a conflict awaiting "Rebind anyway"
  /** @type {HTMLElement | null} */ let note = null; // the conflict / reserved line under the table
  /** @type {(e: KeyboardEvent) => void} */ let onKey = () => {};

  const searchIn = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input", type: "text", placeholder: "Search shortcuts", "aria-label": "Search shortcuts" }));
  searchIn.addEventListener("input", () => { query = searchIn.value.trim().toLowerCase(); search = null; note = null; paint(); });

  const recordBtn = button({ label: "Press a key combination to search…", variant: "outline", size: "sm" });
  tooltip(recordBtn, { title: "Search by key combination" });
  recordBtn.addEventListener("click", () => beginRecording("search"));

  const resetBtn = button({ label: "Reset all to defaults", variant: "outline", size: "sm" });
  resetBtn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Reset all shortcuts to defaults?",
      description: "This clears all custom keybinding overrides and restores every command to its default binding.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    reset();
    pending = null;
    search = null;
    note = null;
    paint();
  });

  const table = h("div", { class: "set-table" });

  const labelOf = (/** @type {string} */ id) => list().find((x) => x.id === id)?.label || id;
  const defaultOf = (/** @type {string} */ id) => list().find((x) => x.id === id)?.default || "";

  function stopListening() {
    window.removeEventListener("keydown", onKey, true);
  }

  /**
   * Record one combination for a row (or the search field). Esc cancels; Backspace restores the row's
   * default; a browser-reserved combo and a taken combo are refused with the §5.12 messages.
   * @param {string} id
   */
  function beginRecording(id) {
    stopListening();
    recording = id;
    note = null;
    onKey = (e) => {
      // Navigated away from this section mid-record: the listener removes itself, or it would swallow every
      // key on the page forever (it is a window-level capture listener with preventDefault inside).
      if (!body.isConnected) { stopListening(); return; }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        stopListening();
        recording = null;
        paint();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // a bare modifier: keep waiting
      if (id !== "search" && e.key === "Backspace") {
        rebind(id, defaultOf(id));
        stopListening();
        recording = null;
        paint();
        return;
      }
      if (isReserved(combo)) {
        stopListening();
        recording = null;
        note = h("div", { class: "set-conflict" }, "This combination is reserved by the system");
        paint();
        return;
      }
      if (id === "search") {
        stopListening();
        recording = null;
        search = combo;
        query = "";
        searchIn.value = "";
        paint();
        return;
      }
      const taken = conflicts(combo, id);
      if (taken.length) {
        stopListening();
        recording = null;
        pending = { id, combo };
        note = h("div", { class: "set-conflict" },
          `Already used by "${labelOf(taken[0])}" · `,
          button({
            label: "Rebind anyway (current command loses it)", variant: "outline", size: "xs",
            onClick: () => { if (pending) { rebind(pending.id, pending.combo); pending = null; note = null; paint(); } },
          }));
        paint();
        return;
      }
      rebind(id, combo);
      stopListening();
      recording = null;
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  }

  function paint() {
    table.replaceChildren(h("div", { class: "set-table-head" },
      h("span", {}, "Command"), h("span", {}, "Keybinding"), h("span", {}, "Scope"), h("span", {}, "Actions")));
    const rows = list().filter((s) => {
      // Show Team while Settings › Experimental's Teams switch is on.
      if (s.id === "view-team" && !teamsOn(state.config)) return false;
      if (search) return s.combo === search;
      if (query) return s.label.toLowerCase().includes(query);
      return true;
    });
    if (!rows.length) {
      table.append(h("div", { class: "set-note" },
        search ? `No command is bound to ${comboLabel(search, mac)}` : "No matching commands"));
    }
    for (const s of rows) {
      // A composer row with no key (Veto this round while Ctrl+Enter sends): a dash, never an empty key cap.
      const binding = recording === s.id
        ? h("span", { class: "set-recording" }, "Press new combination…")
        : s.combo ? h("span", { class: "zc-kbd" }, comboLabel(s.combo, mac))
        : h("span", { class: "set-tr-none", title: "No key: the ⌄ menu beside Send has it" }, "—");
      // The composer's keys follow General's Send with: the row says where they are set.
      const actions = s.rebindable
        ? button({ label: "Rebind", variant: "ghost", size: "xs", title: `Rebind shortcut for "${s.label}"`, onClick: () => beginRecording(s.id) })
        : h("span", { class: "set-tr-where", title: "Set by Send with, in General" }, "In General");
      table.append(h("div", { class: "set-tr" },
        h("span", { class: "set-tr-name" }, s.label),
        binding,
        h("span", { class: "set-tr-scope" }, s.scope === "composer" ? "Composer" : "Global"),
        h("div", { class: "set-tr-acts" }, actions)));
    }
    if (note) table.append(note);
  }

  body.replaceChildren(
    h("div", { class: "set-search-row" }, searchIn, recordBtn, resetBtn),
    table,
  );
  retire = stopListening;
  paint();
}
