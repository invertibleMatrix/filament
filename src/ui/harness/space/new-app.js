// @ts-check
// ＋ New app (the Space Apps plan of 10-29, "Building and changing"): one box — What should it do? — and the starters
// beside it, each a real folder an agent adapts (Pipeline, Team pulse, Reader), Numbers, today's tile dashboard, or — in
// a Space of your own — words an agent makes an app from (To-do list, Habits, A small game). A
// starter picked fills an empty box with its words; Start in a chat copies a starter's folder into the project's
// .filament/apps/ and opens the Start with the words that make the app from it (`POST /space/:project/new-app`). Nothing
// is sent: the person reads the Start and sends it.
import { h } from "../../lib/dom.js";
import { sheet } from "../lib/ui.js";
import { whose } from "../lib/words.js";

/** @typedef {{ id: string, title: string, says: string, words: string, kind: "app" | "dashboard", folder: boolean }} Starter */

/**
 * The sheet, open, its starters read first. `make`: the Start's words for what the person said and the starter picked
 * (null where Filament refused, which the caller says); `startWith`: the Start opened with them.
 * @param {{ place: string, own?: boolean, starters: () => Promise<Starter[]>, make: (said: string, starter: string | null) => Promise<{ words: string, folder?: string } | null>,
 *   startWith: (words: string) => void }} o
 *   `own`: a Space of your own, which is its place: "New app in Northwind", not "Northwind's Space"
 */
export function newAppSheet({ place, own = false, starters, make, startWith }) {
  /** @type {{ close: () => void } | null} */
  let s = null;
  /** @type {Starter[]} */
  let list = [];
  /** @type {string | null} */
  let picked = null;
  const box = /** @type {HTMLTextAreaElement} */ (h("textarea", { class: "snew-box", rows: "4", placeholder: "What should it do?", "aria-label": "What should it do?" }));
  const row = h("div", { class: "snew-starters", role: "group", "aria-label": "Starters" });
  const note = h("p", { class: "sp-quiet snew-note" });
  const go = /** @type {HTMLButtonElement} */ (h("button", { class: "sm primary snew-go", type: "button" }, "Start in a chat"));

  /** What the press does, in words under the starters. */
  function paint() {
    const st = list.find((x) => x.id === picked) || null;
    for (const b of row.querySelectorAll(".snew-starter")) {
      const on = b.getAttribute("data-id") === picked;
      b.setAttribute("aria-pressed", String(on));
      b.className = `snew-starter${on ? " is-on" : ""}`;
    }
    note.textContent = st?.folder
      ? `Copies the ${st.title} starter into ${whose(place)} .filament/apps/ for an agent to adapt, then opens the Start with your words. Nothing runs until you send.`
      : st?.kind === "dashboard"
        ? "Opens the Start to make a dashboard: tiles Filament draws over your commands. Nothing runs until you send."
        : st
          ? "Opens the Start with its words, for an agent to make the app. Nothing runs until you send."
          : "Opens the Start with your words, for an agent to make the app. Nothing runs until you send.";
    go.disabled = !box.value.trim() && !st;
  }

  /** A starter picked, or put down: an empty box — or one still holding another starter's words — takes its words. @param {Starter} st */
  function pick(st) {
    const had = list.find((x) => x.id === picked);
    picked = picked === st.id ? null : st.id;
    const said = box.value.trim();
    if (picked && (!said || said === had?.words)) box.value = st.words;
    else if (!picked && said === st.words) box.value = "";
    paint();
  }

  box.addEventListener("input", paint);
  go.addEventListener("click", async () => {
    if (go.disabled) return;
    go.disabled = true;
    const got = await make(box.value, picked);
    if (!got) return paint();
    s?.close();
    startWith(got.words);
  });

  const body = h("div", { class: "snew-body" },
    box,
    h("h4", { class: "sdb-keep-h" }, "Or start from"),
    row,
    note);
  const foot = h("div", { class: "sdb-keep-foot" }, h("span", { class: "sb-sp" }), h("button", { class: "ghost sm", type: "button", onclick: () => s?.close() }, "Cancel"), go);
  s = sheet({ label: "New app", class: "sdb-keep-sheet snew-sheet", head: h("b", { class: "sp-sheet-title" }, own ? `New app in ${place}` : `New app in ${whose(place)} Space`), body, foot });
  paint();
  void starters().then((got) => {
    list = got;
    row.replaceChildren(...list.map((st) =>
      h("button", { class: "snew-starter", type: "button", "data-id": st.id, "aria-pressed": "false", title: st.words, onclick: () => pick(st) },
        h("b", { class: "snew-starter-t" }, st.title),
        h("span", { class: "sp-quiet snew-starter-s" }, st.says))));
    paint();
  });
  box.focus?.();
  return s;
}
