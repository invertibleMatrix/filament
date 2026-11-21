// @ts-check
// The Artifacts page (HarnessV4_Artifacts_Plan E18, step 4, AF-D9, AF-D10): every page an agent made, on a full-frame
// screen like Settings, at `#/artifacts`. All or Pinned; search over titles and descriptions; grid — each with a still
// preview of its page, loaded as it nears the screen (AFC-81) — or list, the choice kept in this browser (AFC-12); the
// filter: type, project, the model that made it; by month, the last opened or changed first (AFC-11, AFC-14). Each
// one's ⋮ holds Open, Open in browser, Copy link, Pin, Rename, Download, Info, The session that made it and Delete.
// A tile for each type starts a new task that makes one (AFC-45, AFC-121, AFC-143). The page follows each version
// published and each rename, pin and delete, wherever it was done (AFC-83), and draws what it lists in place (dom.js
// `morphChildren`): each month, row and button keyed by what it is, the grid's cards placed and never taken out while
// they stay in their month's grid, so the one under a resting pointer is the element that stood — its hover holds, a
// press on it lands and its preview stays loaded (the owner's of 11-01: buttons blinking under a resting pointer, clicks
// lost). A card that moves to another month's grid, or comes back after the list or a filter that showed nothing, is
// put in once, its preview loading again.
import { h, morphChildren, placeChildren, setHtml, standing } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { ICONS } from "./lib/icons.js";
import { menu, pills, tooltip } from "./lib/ui.js";
import { prefs } from "./prefs.js";
import { artifactAddress, byMonth, filterChoices, markOf, portOf, projectOf, shownArtifacts, touchedWords, typeWord } from "./lib/artifacts.js";
import { artifactItems } from "./artifact-acts.js";
import { artifactPreview, artifactsPlaced } from "./artifact-frame.js";
import { onPublished } from "./artifacts-live.js";
import { WORDS } from "./lib/words.js";

/** @typedef {import("./lib/artifacts.js").ArtifactSeen} ArtifactSeen */
/** @typedef {import("./lib/artifacts.js").ListAsk} ListAsk */

/** A day as a row says it. @param {number} ms */
const dayOf = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric" });
/** A month's name, with its year where it is not this one. @param {number} ms @param {boolean} withYear */
const monthOf = (ms, withYear) => new Date(ms).toLocaleString(undefined, withYear ? { month: "long", year: "numeric" } : { month: "long" });

/**
 * The tiles that start one (AFC-45, AFC-121, AFC-143): one for each type, each naming the artifact and its type, so an
 * agent at work in a project makes an artifact rather than a file.
 */
export const TILES = Object.freeze([
  { type: "page", label: "Page", words: "Make a Page artifact: ", icon: "appWindow" },
  { type: "doc", label: "Doc", words: "Make a Doc artifact: ", icon: "fileText" },
  { type: "slides", label: "Slides", words: "Make a Slides artifact: ", icon: "presentation" },
  { type: "dashboard", label: "Dashboard", words: "Make a Dashboard artifact: ", icon: "layoutDashboard" },
  { type: "design", label: "Design", words: "Make a Design artifact: ", icon: "palette" },
]);

/**
 * @param {HTMLElement} host  the conversation's frame
 * @param {{ onClose: () => void, onOpen: (name: string) => void, onNew: (words: string) => void,
 *   onSession: (chain: string) => void }} o
 *   `onOpen`: its full view; `onNew`: a new task with these words in its message box; `onSession`: open that chat
 */
export function renderArtifactsPage(host, o) {
  if (host.querySelector(".artifacts-page")) return;
  const port = portOf(location);
  // Each one's link — Open in browser, Copy link — at the address the server says this page reads its artifacts at.
  void artifactsPlaced();
  /** @type {ListAsk} */
  const ask = { tab: "all", query: "", type: "", project: "", model: "" };
  /** @type {ArtifactSeen[] | null} */
  let all = null;
  /** @type {string} */
  let failed = "";

  const search = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input artifacts-search", type: "search", placeholder: WORDS.search, "aria-label": "Search artifacts" }));
  search.addEventListener("input", () => {
    ask.query = search.value;
    draw();
  });
  const tabs = pills([{ id: "all", label: "All" }, { id: "pinned", label: "Pinned" }], {
    active: "all",
    onChange: (id) => {
      ask.tab = id === "pinned" ? "pinned" : "all";
      draw();
    },
  });
  const layoutBtn = (/** @type {"grid" | "list"} */ kind) => {
    const b = h("button", { class: "ghost icon sm artifacts-layout", type: "button", "aria-label": kind === "grid" ? "Grid" : "List", "data-layout": kind, html: ICONS[kind === "grid" ? "layoutGrid" : "list"], onclick: () => { prefs.set("artifactsLayout", kind); draw(); } });
    tooltip(b, { title: kind === "grid" ? "Grid" : "List" });
    return b;
  };
  const gridBtn = layoutBtn("grid");
  const listBtn = layoutBtn("list");
  const filterBtn = /** @type {HTMLButtonElement} */ (h("button", { class: "ghost sm artifacts-filter", type: "button" }));
  filterBtn.addEventListener("click", () => filterMenu());
  const tiles = h("div", { class: "artifacts-tiles" },
    ...TILES.map((t) => h("button", { class: "artifacts-tile", type: "button", title: `A new chat, with “${t.words.trim()}” in its message box`, onclick: () => o.onNew(t.words) },
      h("span", { class: "artifact-tile", html: ICONS[/** @type {keyof typeof ICONS} */ (t.icon)] }),
      h("span", { class: "artifacts-tile-label" }, t.label))));
  const body = h("div", { class: "artifacts-body" });
  const page = h("div", { class: "artifacts-page" },
    h("div", { class: "settings-top" },
      h("span", { class: "settings-crumb" }, "Artifacts"),
      h("button", { class: "ghost sm", type: "button", onclick: () => o.onClose() }, "Back to chat")),
    h("div", { class: "artifacts-scroll" },
      h("h2", { class: "set-title" }, "Artifacts"),
      h("p", { class: "set-desc" }, "Pages your agents made. Each one opens on its own address, in Filament or in your browser."),
      h("div", { class: "artifacts-bar" }, tabs.el, h("span", { class: "grow" }), search, h("span", { class: "artifacts-layouts" }, gridBtn, listBtn), filterBtn),
      h("h3", { class: "artifacts-h" }, "Make something new"),
      tiles,
      body));
  host.append(page);

  /** The filter's menu (AF-D9): one choice each of type, project and model; Any clears it. */
  function filterMenu() {
    const c = filterChoices(all || []);
    /**
     * @param {"type" | "project" | "model"} key @param {string} label @param {string[]} values
     * @param {(v: string) => string} [word]
     */
    const group = (key, label, values, word = (v) => v) => values.length
      ? [{ type: "label", label }, { type: "radio", label: "Any", checked: !ask[key], onClick: () => { ask[key] = ""; draw(); } },
          ...values.map((v) => ({ type: "radio", label: word(v), checked: ask[key] === v, onClick: () => { ask[key] = v; draw(); } }))]
      : [];
    menu([
      ...group("type", "Type", c.types, typeWord),
      ...group("project", "Project", c.projects),
      ...group("model", "Made by", c.models),
      ...(ask.type || ask.project || ask.model ? [{ type: "separator" }, { label: "Clear the filter", icon: "x", onClick: () => { ask.type = ask.project = ask.model = ""; draw(); } }] : []),
    ], { anchor: filterBtn, align: "end", width: 240 });
  }

  /** Its ⋮. @param {ArtifactSeen} a @param {HTMLElement} anchor */
  const more = (a, anchor) => menu(artifactItems(a, artifactAddress(a.name, port), { open: () => o.onOpen(a.name), onSession: o.onSession }), { anchor, align: "end", width: 220 });
  /**
   * Its ⋮ button, for the record as it is when pressed. The menu hangs off the button on the page (`currentTarget`): a
   * row drawn in place keeps its button and takes this draw's press.
   * @param {() => ArtifactSeen} now
   */
  const moreBtn = (now) =>
    h("button", { class: "ghost icon sm artifacts-more", type: "button", "data-key": "more", "aria-label": "More", html: ICONS.ellipsis, onclick: (/** @type {MouseEvent} */ e) => {
      e.stopPropagation();
      more(now(), /** @type {HTMLElement} */ (e.currentTarget));
    } });
  /** What a row or card says under its title: its type, project and model. @param {ArtifactSeen} a */
  const metaOf = (a) => [typeWord(a.type), projectOf(a.folder), a.model].filter(Boolean).join(" · ");
  /**
   * What a click on a row or card does — opens it — and a right click — its ⋮ —, for the record as it is then, as the
   * attributes `h` takes, so a row drawn in place takes the newest; its ⋮ button keeps its own click.
   * @param {() => ArtifactSeen} now
   */
  const opening = (now) => ({
    onclick: () => o.onOpen(now().name),
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        o.onOpen(now().name);
      }
    },
    oncontextmenu: (/** @type {MouseEvent} */ e) => {
      e.preventDefault();
      more(now(), /** @type {HTMLElement} */ (e.currentTarget));
    },
  });

  /**
   * The grid's cards, kept by name while their newest version stays, so a rename or a pin repaints the words and
   * leaves the preview loaded. @type {Map<string, { el: HTMLElement, v: number, paint: (a: ArtifactSeen) => void }>}
   */
  const cards = new Map();
  /** @param {ArtifactSeen} a */
  const cardOf = (a) => {
    const v = a.versions.length;
    const had = cards.get(a.name);
    if (had && had.v === v) {
      had.paint(a);
      return had.el;
    }
    const tile = h("span", { class: "artifact-tile sm" });
    const title = h("span", { class: "artifact-title" });
    const meta = h("span", { class: "artifact-meta" });
    const pin = h("span", { class: "artifacts-pin", html: ICONS.pin, "aria-label": "Pinned" });
    let current = a;
    const foot = h("div", { class: "artifacts-card-foot" }, tile, h("span", { class: "artifact-words" }, title, meta), pin, moreBtn(() => current));
    const el = h("div", { class: "artifacts-card", tabindex: "0", role: "button", "data-artifact-row": a.name, ...opening(() => current) }, artifactPreview(a.name, v, a.title), foot);
    const paint = (/** @type {ArtifactSeen} */ x) => {
      current = x;
      setHtml(tile, ICONS[markOf(x.icon)] || "");
      title.textContent = x.title;
      meta.textContent = `${metaOf(x)} · ${touchedWords(x, dayOf)}`;
      el.setAttribute("aria-label", `Open ${x.title}`);
      pin.classList.toggle("hidden", !x.pinned);
    };
    paint(a);
    cards.set(a.name, { el, v, paint });
    return el;
  };
  /** A list's row, keyed by its name for the draw in place, its parts by what they are. @param {ArtifactSeen} a */
  const rowOf = (a) =>
    h("div", { class: "artifacts-row", tabindex: "0", role: "button", "aria-label": `Open ${a.title}`, "data-artifact-row": a.name, "data-key": a.name, ...opening(() => a) },
      h("span", { class: "artifact-tile sm", "data-key": "tile", html: ICONS[markOf(a.icon)] || "" }),
      h("span", { class: "artifact-words", "data-key": "words" }, h("span", { class: "artifact-title" }, a.title), h("span", { class: "artifact-meta" }, metaOf(a))),
      a.pinned ? h("span", { class: "artifacts-pin", "data-key": "pin", html: ICONS.pin, "aria-label": "Pinned" }) : null,
      h("span", { class: "artifacts-when", "data-key": "when" }, touchedWords(a, dayOf)),
      moreBtn(() => a));

  /** What it says where there is nothing to list (AFC-10): why, and what to do. @param {string} words */
  const empty = (words, ...more) => h("div", { class: "artifacts-empty" }, h("p", {}, words), ...more);

  function draw() {
    const layout = prefs.get("artifactsLayout") === "list" ? "list" : "grid";
    gridBtn.classList.toggle("on", layout === "grid");
    listBtn.classList.toggle("on", layout === "list");
    gridBtn.setAttribute("aria-pressed", String(layout === "grid"));
    listBtn.setAttribute("aria-pressed", String(layout === "list"));
    const n = [ask.type, ask.project, ask.model].filter(Boolean).length;
    morphChildren(filterBtn, [h("span", { class: "artifacts-filter-ic", html: ICONS.listFilter }), n ? `Filter · ${n}` : "Filter"]);
    filterBtn.classList.toggle("on", n > 0);
    if (failed) {
      morphChildren(body, [empty(`The artifacts could not be read: ${failed}.`, h("button", { class: "sm", type: "button", onclick: () => void load() }, "Try again"))]);
      return;
    }
    if (!all) {
      morphChildren(body, [empty("Reading the artifacts…")]);
      return;
    }
    if (!all.length) {
      morphChildren(body, [empty("No artifacts yet. An artifact is a page an agent makes for you — a tracker, a calculator, a doc, a deck — that opens on its own address. Ask any agent in a chat to make one, or start from a tile above.")]);
      return;
    }
    const shown = shownArtifacts(all, ask);
    if (!shown.length) {
      const filtered = ask.query.trim() || n;
      morphChildren(body, [ask.tab === "pinned" && !filtered
        ? empty("Nothing pinned yet. Pin one from its ⋮ menu, or from its full view.")
        : empty(ask.query.trim() ? `Nothing ${ask.tab === "pinned" ? "pinned " : ""}matches “${ask.query.trim()}”${n ? " with this filter" : ""}.` : "Nothing matches this filter.",
          h("button", { class: "sm", type: "button", onclick: () => { ask.query = search.value = ""; ask.type = ask.project = ask.model = ""; draw(); } }, "Clear the search and filter"))]);
      return;
    }
    const kept = new Set(shown.map((a) => a.name));
    for (const name of [...cards.keys()]) if (!kept.has(name)) cards.delete(name);
    /** Each grid of this draw, with the artifacts whose cards go in it. @type {[HTMLElement, ArtifactSeen[]][]} */
    const grids = [];
    morphChildren(body, byMonth(shown, Date.now(), monthOf).map((m) => {
      const list = layout === "grid"
        ? h("div", { class: "artifacts-grid", "data-key": "grid", "data-placed": "" })
        : h("div", { class: "artifacts-list", "data-key": "list" }, ...m.items.map(rowOf));
      if (layout === "grid") grids.push([list, m.items]);
      return h("section", { class: "artifacts-month", "data-key": `month:${m.key}` }, h("h3", { class: "artifacts-h" }, m.label), list);
    }));
    // The cards go into the grids as they stand on the page, placed rather than drawn (`data-placed`): a card that stays
    // in its grid is never taken out — a frame taken out of the document loads again —, and only one out of place moves.
    // One that changes month, or whose grid is new (from the list, or after nothing shown), is put in there once.
    for (const [grid, items] of grids) placeChildren(standing(grid), items.map(cardOf));
  }

  /** Read them all again: once now, and after each change heard (AFC-83) but to a page's data, never listed here. */
  async function load() {
    try {
      all = /** @type {ArtifactSeen[]} */ ((await api("/artifacts")).artifacts || []);
      failed = "";
    } catch (e) {
      failed = String(/** @type {any} */ (e)?.message || e).replace(/\.$/, "");
    }
    if (page.isConnected) draw();
  }
  let again = 0;
  const off = onPublished((p) => {
    if (!page.isConnected) return off();
    if (p.change === "data") return;
    // A burst of changes (a publish beside a rename in another tab) is one read.
    window.clearTimeout(again);
    again = window.setTimeout(() => void load(), 120);
  });
  draw();
  void load();
}
