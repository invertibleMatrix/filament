// @ts-check
// The watchers' line over the box (the plan of 11-11, its w8): a chat a watcher watches says so where the person
// writes — "Watched by Supervisor · reviews each turn, may guide" —, and a chat a watcher wakes says what it watches —
// "Watching Build the login flow · wakes this chat after each turn". One line for each of the two, the watched one
// first; each with one press at its end: Pause while its one watcher listens, Resume while it is paused, Open — the
// Space's Watchers — where two or more are behind the line, and under Pause all, which holds every one of them: its
// Resume is there. Only watchers switched on are said: one proposed watches nothing yet. The words are Filament's
// (core/routines.js `chatWatchers`, in the chat's transcript and on the events feed as `watchers`); the line puts them
// together and counts.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";

/** What each press does, on hover: the line's, and a guidance card's (turn.js). */
export const WATCH_PRESS = {
  pause: { label: "Pause", title: "It listens no more until you resume it" },
  resume: { label: "Resume", title: "It listens again; what happened while it was paused is not made up" },
  open: { label: "Open", title: "Open this Space's Watchers" },
};

/**
 * A watcher of the chat, as Filament says it: `role`, whether it watches this chat (`watched`) or wakes it (`watches`);
 * `chat`, the chat to open for it, "" where it has none; `pausedAll`, Pause all holds it whatever its own switch says.
 * @typedef {{ id: string, project: string, title: string, state: string, paused: boolean, role: "watched" | "watches",
 *   chat?: string, pausedAll?: boolean, words: { lead: string, name: string, does: string, full: string } }} ChatWatcher
 * @typedef {{ lead: string, name: string, rest: string, tip: string, press: "pause" | "resume" | "open", paused: boolean,
 *   of: ChatWatcher }} WatchLine  `name`: the one name on the line, said strongly; `tip`: each watcher's whole words;
 *   `of`: the watcher its press is of — the one named
 */

/**
 * One of the chat's two lines, or null where no watcher that is on has that role.
 * @param {ChatWatcher[] | null | undefined} list  the chat's watchers
 * @param {"watched" | "watches"} role
 * @returns {WatchLine | null}
 */
export function watchLineOf(list, role) {
  const mine = (Array.isArray(list) ? list : []).filter((w) => w && w.state === "on" && w.role === role);
  if (!mine.length) return null;
  const tip = mine.map((w) => w.words.full).join("\n");
  const first = mine.find((w) => !w.paused);
  const more = mine.length - 1;
  // Pause all holds every one of them: none listens, and its Resume is the Space's, so the press opens it.
  if (mine.some((w) => w.pausedAll)) return { lead: "", name: (first || mine[0]).title, rest: more ? ` and ${more} more do not listen: Pause all is on` : " does not listen: Pause all is on", tip, press: "open", paused: true, of: first || mine[0] };
  if (!first) {
    // Every one paused: by its title, the watcher's own name whichever way it faces.
    const of = mine[0];
    return { lead: "", name: of.title, rest: more ? ` and ${more} more are paused` : " is paused", tip, press: more ? "open" : "resume", paused: true, of };
  }
  if (!more) return { lead: `${first.words.lead} `, name: first.words.name, rest: ` · ${first.words.does}`, tip, press: "pause", paused: false, of: first };
  const paused = mine.filter((w) => w.paused).length;
  return { lead: `${first.words.lead} `, name: first.words.name, rest: ` and ${more} more${paused ? ` · ${paused} paused` : ""}`, tip, press: "open", paused: false, of: first };
}

/**
 * @param {{ onPress: (line: WatchLine) => void }} o  `onPress`: the line's press — its `press` says which
 * @returns {{ el: HTMLElement, paint: (line: WatchLine | null) => void }}
 */
export function createWatchLine({ onPress }) {
  /** @type {WatchLine | null} */
  let shown = null;
  const lead = h("span", { class: "watch-line-lead" });
  const name = h("span", { class: "watch-line-name" });
  const what = h("span", { class: "watch-line-what" });
  const words = h("span", { class: "watch-line-words" }, lead, name, what);
  const go = h("button", { class: "watch-line-go", type: "button", onclick: () => { if (shown) onPress(shown); } });
  const el = h("div", { class: "watch-line hidden", role: "status" }, h("span", { class: "watch-line-icon", html: ICONS.eye, "aria-hidden": "true" }), words, go);
  /** What it says, as last painted: painted again only when that moves. */
  let said = "";
  return {
    el,
    // Its words in place, its button the one element it was: a press under a resting pointer lands on what it says.
    paint(line) {
      const key = line ? JSON.stringify([line.lead, line.name, line.rest, line.tip, line.press, line.paused, line.of.project, line.of.id]) : "";
      shown = line;
      if (key === said) return;
      said = key;
      el.classList.toggle("hidden", !line);
      if (!line) return;
      el.classList.toggle("is-paused", line.paused);
      lead.textContent = line.lead;
      name.textContent = line.name;
      what.textContent = line.rest;
      words.setAttribute("title", line.tip);
      go.textContent = WATCH_PRESS[line.press].label;
      go.setAttribute("title", WATCH_PRESS[line.press].title);
    },
  };
}
