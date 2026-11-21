// @ts-check
// Library › Skills (HarnessV4_Skills_Plan S1-6, the Designer's of 10-27; Product's mock A of 11-07): your skills, for
// every agent — Filament's own, Claude Code, Codex and Cursor —, built like Connectors. "Always on in" along the top picks
// the place (all chats, a Space of yours, a project); the list is two sections, the skills always on there and those you
// tag when you need them, each named by its tag ($name) with Copy beside it, and How skills work says what each way
// costs. Each of your skills has a switch for the place, ↺ back to what it inherits, and ⋯ (Update a git one, Remove
// from Filament). A plugin's skills are listed under it, on wherever the plugin is: no switch of their own. Add
// skills… is one wide dialog: what the coding agents keep on this computer, none ticked, and a folder or a git address;
// what it adds is on nowhere, tagged when needed. A skill opens as a page of its own (`#/library/skills/<name>`): where it came from, where
// it is on, what it costs a request, its files beside the one shown; one made in Filament is written there, and carries
// Books (step 2, the Designer's of 10-27): PDFs, Markdown and text files split into parts agents look things up in, and
// Craft it in a chat…, its crafter chat (app/crafter-chats.js), where the page is given one. New skill… makes one. Built with an injected `h`, `api`, menu and dialogs, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { mdDoc } from "../../lib/md.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { confirmDialog, dialog, menu } from "../lib/ui.js";
import { appliesTo } from "../lib/applies-to.js";
import { browseFolder, pathExample } from "../lib/folder-browse.js";
import { state } from "../state.js";
import { routeFor } from "../lib/router.js";

/** A folder of a skill's with more files than this is folded in its Files list until opened. */
export const FOLD_FROM = 8;
/** The most a file sent from the page holds; past it, its path is given instead. */
export const SEND_BYTES_MAX = 45 * 1024 * 1024;
/** A book's pages with no text are said in the warning's colour past this many, or this share of its pages. */
export const NO_TEXT_LOUD = { pages: 5, share: 0.05 };
/** The kinds of file a book is, by their ending. */
const BOOK_ENDINGS = /\.(pdf|md|markdown|txt)$/i;

/**
 * The injected parts. `base64`: a picked file's bytes as base64 (the page's FileReader); `copy`: text to the clipboard;
 * `store`: where How skills work keeps that it was seen (the page's localStorage).
 * @typedef {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, menu?: typeof menu, dialog?: typeof dialog,
 *   confirm?: typeof confirmDialog, go?: (hash: string) => void, browse?: typeof browseFolder,
 *   base64?: (file: any) => Promise<string>, later?: (fn: () => void, ms: number) => void, lastModel?: () => string,
 *   copy?: (text: string) => Promise<void>, store?: { getItem: (k: string) => string | null, setItem: (k: string, v: string) => void } | null }} SkillsIo
 */

/** How skills work, its two cards (Product's mock A of 11-07): the two ways a skill reaches a chat, what each costs. */
export const HOW_CARDS = Object.freeze([
  { title: "Always on", words: "Listed in the agent's system prompt, one line each, in every chat where it's on. The agent knows it's there and loads the whole skill by itself when a request needs it. Each one costs its line in every message, so turn on the few you use all the time." },
  { title: "Tag it when you need it", words: "Type $ and its name in the message box. The agent loads it on demand for that message. The tag only points to the skill; nothing is pasted in, unless the model takes no tools. It costs nothing until you tag it, so it suits skills you use now and then.", example: ["Why does no model answer? ", "$filament-setup"] },
]);
/** Under the cards. */
export const HOW_FOOT = "A skill can include other skills. The agent loads those too when the work needs them.";
/** Always on with none on at the place. */
export const NONE_ON = "Nothing is always on yet, and every skill below works when you tag it. Turn one on when you'd want the agent to know it in most chats.";
/** Whether How skills work was seen: it opens on the first visit only. */
const HOW_SEEN = "filament.skills.howSeen";

/** "1 book", "3 books". @param {number} n @param {string} word */
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Page numbers as ranges: "3, 7–9". @param {number[]} pages */
export function pageSpans(pages) {
  /** @type {string[]} */
  const out = [];
  const list = [...new Set(pages || [])].sort((a, b) => a - b);
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    out.push(j > i ? `${list[i]}–${list[j]}` : String(list[i]));
    i = j;
  }
  return out.join(", ");
}

/**
 * A book's parts in words, as a toast says them: "24 parts, one per chapter", "1 part — it has no headings to split by".
 * @param {{ split: string, parts: { pages: [number, number] | null }[] }} b
 */
export function partsWords(b) {
  const n = b.parts.length;
  const span = b.parts[0]?.pages ? b.parts[0].pages[1] - b.parts[0].pages[0] + 1 : 0;
  if (b.split === "chapters") return `${count(n, "part")}, one per chapter`;
  if (b.split === "headings") return `${count(n, "part")}, one per heading`;
  if (b.split === "pages") return `${count(n, "part")} of ${count(span, "page")} — it has no chapters to split by`;
  if (b.split === "files") return `${count(n, "part")}, one per file and heading`;
  return `${count(n, "part")} — it has no headings to split by`;
}

/**
 * How a book was split, under its name: "312 pages · 24 parts, one per chapter", "37 files · 52 parts, one per file
 * and heading". @param {{ split: string, kind: string, pages: number | null, files?: number, parts: { pages: [number, number] | null }[] }} b
 */
export function bookLine(b) {
  const size = b.pages ? `${count(b.pages, "page")} · ` : b.kind === "folder" ? `${count(b.files || 0, "file")} · ` : "";
  return `${size}${partsWords(b)}`;
}

/** A book's pages with no text, said; "" where it has none. @param {{ noText?: number[] }} b */
export function noTextLine(b) {
  const n = b.noText?.length || 0;
  return n ? `No text on page${n === 1 ? "" : "s"} ${pageSpans(b.noText || [])} — blank, or scans: agents can't look up what is on them.` : "";
}

/**
 * The Files list as shown: a folder of more than FOLD_FROM files folded into one row (`folded`: how many) until it is
 * opened; `references` itself is never folded, so INDEX.md and each book's folder show.
 * @param {{ path: string, dir: boolean, size: number }[]} files @param {Set<string>} open
 * @returns {{ path: string, dir: boolean, size: number, folded?: number }[]}
 */
export function filesShown(files, open) {
  /** @type {Map<string, number>} */
  const under = new Map();
  for (const f of files)
    if (!f.dir) {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) under.set(parts.slice(0, i).join("/"), (under.get(parts.slice(0, i).join("/")) || 0) + 1);
    }
  /** @type {{ path: string, dir: boolean, size: number, folded?: number }[]} */
  const out = [];
  let hidden = "";
  for (const f of files) {
    if (hidden && f.path.startsWith(`${hidden}/`)) continue;
    hidden = "";
    const n = f.dir ? under.get(f.path) || 0 : 0;
    if (f.dir && f.path !== "references" && n > FOLD_FROM && !open.has(f.path)) {
      out.push({ ...f, folded: n });
      hidden = f.path;
      continue;
    }
    out.push(f);
  }
  return out;
}

/**
 * The app whose own folder a skill was linked from, by the name the server gives it (`fromWords`; FB 6: the page holds
 * no table of the agents' names), or "" for a folder, a copy or a skill made here.
 * @param {{ kind: string, from: string, fromWords?: string }} s
 */
const appOf = (s) => (s.kind === "linked" && s.from !== "folder" ? s.fromWords || s.from : "");

/** Where a skill came from, as its chip says it. @param {{ kind: string, from: string, fromWords?: string }} s */
export function fromChip(s) {
  const app = appOf(s);
  if (app) return `${app}'s`;
  const by = /** @type {Record<string, string>} */ ({ folder: "imported", git: "from git", made: "made here", filament: "Filament's" });
  return by[s.from] || s.fromWords || s.from;
}

/**
 * The places a skill is on, and those that turn it off, in words: "on for all chats, Unity Game · off for Work"; none
 * where it is on nowhere — a tag loads it all the same. @param {{ label: string, on: boolean }[]} places
 */
export function whereWords(places) {
  const on = (places || []).filter((p) => p.on).map((p) => p.label);
  const off = (places || []).filter((p) => !p.on).map((p) => p.label);
  return on.length ? `on for ${on.join(", ")}${off.length ? ` · off for ${off.join(", ")}` : ""}` : "";
}

/**
 * The words beside "Always on in": what the place's switches reach.
 * @param {string} scope @param {{ name?: string, space?: boolean, shows?: number } | null} place
 */
export function noteWords(scope, place) {
  if (scope === "all") return "Every chat gets these, unless its project or the chat turns one off.";
  const shows = place?.space && place.shows ? ` and in the ${place.shows === 1 ? "project" : `${place.shows} projects`} it shows` : "";
  return `Chats in ${place?.name || (place?.space ? "this Space" : "this project")}${shows} get what's on for all chats, with the changes you make here.`;
}

/**
 * A switch flipped, in a toast: on, what it costs every message; off, how it is loaded still.
 * @param {string} name @param {boolean} on @param {string} place @param {number} [tokens] its line's
 */
export function toastWords(name, on, place, tokens = 0) {
  return on
    ? `${name} is always on in ${place}${tokens ? `: about ${tokens} tokens in every message` : ""}, starting with each chat's next message.`
    : `${name} is off for ${place}. Tag it as $${name} when you need it.`;
}

/** Always on's head: how many, and what their lines cost every message. @param {number} n @param {number} tokens */
export function onWords(n, tokens) {
  return n ? `${count(n, "skill")}${tokens ? ` · about ${tokens} tokens in every message` : ""}` : "";
}

/**
 * What an Update did: the commit it moved to, and the skills new in the repository, added on nowhere.
 * @param {string} name @param {{ changed: boolean, before: string, now: string, added?: { name: string }[] }} r
 */
export function updatedWords(name, r) {
  const fresh = (r.added || []).map((s) => s.name);
  const head = r.changed ? `${name} is up to date: ${r.before} → ${r.now}.` : `${name} was up to date already.`;
  return fresh.length ? `${head} New in it: ${fresh.join(", ")}.` : head;
}

/**
 * What Remove from Filament… says first, by where the skill came from; a made one's page names its books.
 * @param {{ kind: string, from: string, fromWords?: string, books?: any[] }} s
 */
export function removeWords(s) {
  if (s.kind === "git") return "Filament's copy goes.";
  if (s.kind === "made") return s.books?.length ? `Its folder in Filament goes with everything in it: its SKILL.md and its ${count(s.books.length, "book")}.` : "Its folder in Filament goes with everything in it.";
  const app = appOf(s);
  return app ? `The files stay in ${app}'s folder; ${app} keeps loading it.` : "The folder stays; Filament stops reading it.";
}

/** Where a skill came from, in a line on its page. @param {{ kind: string, from: string, fromWords?: string, url?: string, sha?: string, path: string }} s */
export function fromLine(s) {
  const app = appOf(s);
  if (app) return `From ${app}'s folder — ${app} loads it itself; Filament gives it to the other agents.`;
  if (s.kind === "git") return `From ${s.url}${s.sha ? ` at ${s.sha}` : ""} — Filament's copy; Update fetches it again.`;
  if (s.kind === "made") return "Made in Filament: written here.";
  if (s.kind === "shipped") return "Comes with Filament.";
  return `From a folder on this computer — Filament reads it there, so your edits show.`;
}

/** A place with more skills on than a chat lists. @param {string} place @param {number} count @param {number} most */
export function overWords(place, count, most) {
  return `${place} has ${count} skills on: its chats get the first ${most}, and ${count - most} are left out.`;
}

/** The empty list's words, with what the coding agents keep here. @param {{ label: string, skills: any[] }[] | null} agents */
export function emptyWords(agents) {
  const found = (agents || []).filter((a) => a.skills.length);
  const total = found.reduce((n, a) => n + a.skills.length, 0);
  if (!total) return "No skills yet. A skill is a folder with a SKILL.md: add one from this computer or a git address, or make one here.";
  return `No skills yet. Your agents keep ${total} on this computer, each for itself — ${found.map((a) => `${a.label} ${a.skills.length}`).join(" · ")}.`;
}

/** A SKILL.md without its front matter, for the page to show. @param {string} text */
const bodyOf = (text) => String(text || "").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
/** A size in words. @param {number} n */
const sizeWords = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
/** An error's words. @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);
/** A picked file's bytes as base64, through the page's FileReader. @param {any} file @returns {Promise<string>} */
const fileBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error || new Error(`${file?.name || "the file"} could not be read`));
    r.readAsDataURL(file);
  });
/** An element's children put in place, the empty ones left out: replaceChildren writes a null as its text. @param {any} el @param {...any} kids */
const fill = (el, ...kids) => el?.replaceChildren(...kids.filter((k) => k !== null && k !== undefined && k !== false));
/** A small button. */
const btn = (/** @type {typeof h} */ m, /** @type {string} */ label, /** @type {string} */ variant, /** @type {() => void} */ onClick, /** @type {Record<string, any>} */ extra = {}) =>
  m("button", { class: `zc-btn zc-btn-v-${variant} zc-btn-s-sm${extra.cls ? ` ${extra.cls}` : ""}`, type: "button", onclick: onClick, ...(extra.disabled ? { disabled: "" } : {}), ...(extra.title ? { title: extra.title, ...(label ? {} : { "aria-label": extra.title }) } : {}) },
    extra.html ? m("span", { class: "zc-btn-ic", html: extra.html }) : null, label ? m("span", { class: "zc-btn-label" }, label) : null);
/** A switch. */
const switchEl = (/** @type {typeof h} */ m, /** @type {boolean} */ on, /** @type {string} */ label, /** @type {() => void} */ onClick) =>
  m("button", { class: `set-switch${on ? " on" : ""}`, type: "button", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": label, onclick: onClick });

/**
 * The list.
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, start?: string | null, acts?: HTMLElement | null }} [cb]
 *   `start`: "project:<id>" opens on that project or Space (a Space's ⋯ › Skills…); `acts`: the title
 *   row, where Add skills… stands
 * @param {SkillsIo} [io]
 */
/** The place the list last showed, for Back to Skills from a skill's page (Hunter's find: it came back on All chats). */
let lastPlace = "all";
/** The place Library › Skills last showed: `all` or `project:<id>`. */
export const skillsPlace = () => lastPlace;

export function renderSkills(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openMenu = io.menu || menu;
  const openDialog = io.dialog || dialog;
  const confirm = io.confirm || confirmDialog;
  const go = io.go || ((/** @type {string} */ hash) => { location.hash = hash; });
  const toast = (/** @type {string} */ msg, /** @type {string} */ kind = "") => cb.onToast?.(msg, kind || undefined);
  // A page served over plain http to another device has no clipboard: said as the header's Copy says it.
  const copy = io.copy || ((/** @type {string} */ text) => (globalThis.navigator?.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("Copy failed"))));
  const store = io.store !== undefined ? io.store : (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
  // How skills work opens on the first visit, and is there to open after.
  let howOpen = (() => { try { return !store?.getItem(HOW_SEEN); } catch { return false; } })();
  /** How skills work was pressed: the button drawn anew takes the focus back. */
  let focusHow = false;
  try { store?.setItem(HOW_SEEN, "1"); } catch {}
  let scope = "all";
  let placeName = "All chats";
  /** @type {any} */
  let data = null;
  let failed = "";
  let filter = "";
  /** What the coding agents keep on this computer, read once the list is empty. @type {any[] | null} */
  let found = null;
  const host = m("div", { class: "skl" });

  const control = appliesTo({
    label: "Always on in",
    onToast: cb.onToast,
    onPick: (s, place) => {
      scope = s;
      lastPlace = s;
      placeName = s === "all" ? "All chats" : place?.name || "this project";
      control.say(noteWords(s, place));
      void refresh();
    },
  }, io);
  const newBtn = () => btn(m, "New skill…", "outline", () => void openNew(), { html: ICONS.plus, title: "A skill you write here, and give books to look things up in." });
  cb.acts?.replaceChildren(newBtn(), btn(m, "Add skills…", "default", () => void openAdd(), { html: ICONS.plus }));
  body.replaceChildren(control.el, host);
  control.start(/^project:/.test(String(cb.start || "")) ? String(cb.start).slice("project:".length) : null);

  async function refresh() {
    const want = scope;
    try {
      const got = await call(`/skills?place=${encodeURIComponent(want)}`);
      if (want !== scope) return;
      data = got;
      failed = "";
    } catch (e) {
      if (want !== scope) return;
      failed = errText(e);
      // The rows shown are the place's they were read for: a place that could not be read says why, never shows
      // another's switches, which would write to it from that place's state (Hunter's find).
      if (data?.place?.place !== want) data = null;
    }
    if (data && !data.skills.length && !data.plugins.length && found == null) {
      found = [];
      try {
        found = (await call(`/skills/found?place=${encodeURIComponent(scope)}`)).agents || [];
      } catch {}
    }
    paint();
  }

  /** @param {any} s */
  async function setOn(s, on) {
    try {
      await call(`/skills/${encodeURIComponent(s.name)}/on`, { method: "POST", body: { place: scope, on } });
      toast(on === null ? `${s.name} is back to what ${placeName} inherits.` : toastWords(s.name, on, scope === "all" ? "all chats" : placeName, Number(s.lineTokens) || 0));
    } catch (e) {
      toast(errText(e), "err");
    }
    await refresh();
  }

  /** @param {any} s */
  async function update(s) {
    try {
      const r = await call(`/skills/${encodeURIComponent(s.name)}/update`, { method: "POST", body: {} });
      toast(updatedWords(s.name, r));
    } catch (e) {
      toast(errText(e), "err");
    }
    await refresh();
  }

  /** @param {any} s */
  async function remove(s) {
    if (!(await confirm({ title: `Remove ${s.name} from Filament?`, description: `It goes off every chat. ${removeWords(s)}`, confirmLabel: "Remove", destructive: true }))) return;
    try {
      await call(`/skills/${encodeURIComponent(s.name)}`, { method: "DELETE" });
      toast(`${s.name} is removed from Filament.`);
    } catch (e) {
      toast(errText(e), "err");
    }
    await refresh();
  }

  /** Copy $name: the tag, to paste in a message. @param {string} name */
  async function copyTag(name) {
    try {
      await copy(`$${name}`);
      toast(`Copied $${name}. Paste it in a message and the agent loads the skill for that message.`);
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  /**
   * One of your skills: its tag (which opens it), where it came from and is on, its words in a line; ↺, Copy $name, its
   * switch, ⋯. One off here is not dimmed: a tag loads it all the same.
   * @param {any} s
   */
  function rowEl(s) {
    const on = !!s.on?.on;
    const more = m("button", { class: "mcps-more", type: "button", title: `More for ${s.name}`, "aria-label": `More for ${s.name}`, html: ICONS.ellipsis });
    more.addEventListener("click", () => {
      openMenu([
        { label: "Open", icon: "bookOpen", onClick: () => go(routeFor("library", { page: "skills", scope: s.name })) },
        s.kind === "git" ? { label: "Update", icon: "refreshCw", onClick: () => void update(s) } : null,
        s.kind !== "shipped" ? { type: "separator" } : null,
        s.kind !== "shipped" ? { label: "Remove from Filament…", icon: "trash2", variant: "destructive", onClick: () => void remove(s) } : null,
      ].filter(Boolean), { anchor: more, align: "end" });
    });
    const back = scope !== "all" && s.on?.here
      ? m("button", { class: "mcps-back", type: "button", title: "Back to what it inherits", "aria-label": `${s.name}: back to what it inherits`, html: ICONS.rotateCcw, onclick: () => void setOn(s, null) })
      : null;
    const where = whereWords(s.places);
    return m("div", { class: "mcps-row", "data-name": s.name },
      m("div", { class: "mcps-text" },
        m("div", { class: "mcps-label" },
          m("button", { class: "skl-name", type: "button", title: `Open ${s.name}`, onclick: () => go(routeFor("library", { page: "skills", scope: s.name })) }, `$${s.name}`),
          m("span", { class: `mcps-src${s.on?.here ? " is-here" : ""}` }, where ? `${fromChip(s)} · ${where}` : fromChip(s))),
        s.description ? m("div", { class: "mcps-sub skl-desc", title: s.description }, s.description) : null,
        s.there ? null : m("div", { class: "mcps-sub is-bad" }, "Its folder is gone: no chat gets it until it is back.")),
      m("span", { class: "mcps-ctl" }, back, btn(m, `Copy $${s.name}`, "ghost", () => void copyTag(s.name), { cls: "skl-copy" }), switchEl(m, on, `${s.name} for ${placeName}`, () => void setOn(s, !on)), more));
  }

  /** A plugin's skills and commands, on wherever it is: no switch of their own. @param {any} p */
  function pluginEl(p) {
    const where = p.places.length ? p.places.join(", ") : "nowhere yet";
    const line = (/** @type {string} */ name, /** @type {string} */ words) => m("div", { class: `mcps-row${p.on ? "" : " is-off"}` }, m("div", { class: "mcps-text" }, m("div", { class: "mcps-label" }, m("span", { class: "mcps-name" }, name), words ? m("span", { class: "mcps-sub" }, words) : null)));
    return m("div", { class: "skl-sec", "data-plugin": p.id },
      m("div", { class: "skl-sec-h" },
        m("span", { class: "mcps-name" }, `${p.title} plugin`),
        m("span", { class: "mcps-sub" }, `on where ${p.title} is on: ${where}`),
        m("span", { class: "lib-gap" }),
        btn(m, `Open ${p.title} ›`, "ghost", () => go(routeFor("library", { page: "plugins", scope: p.id })))),
      m("div", { class: "mcps-rows" }, ...p.skills.map((/** @type {string} */ n) => line(n, "")), ...p.commands.map((/** @type {string} */ n) => line(`/${n}`, "a command you can also type"))));
  }

  function paint() {
    if (!data) {
      host.replaceChildren(failed ? m("p", { class: "mcps-failed" }, failed) : m("p", { class: "mcps-quiet" }, "Reading your skills…"));
      return;
    }
    const mine = /** @type {any[]} */ (data.skills);
    const howBtn = m("button", { class: "skl-how-btn", type: "button", "aria-expanded": howOpen ? "true" : "false", onclick: () => { howOpen = !howOpen; focusHow = true; paint(); } },
      m("span", { class: `skl-how-chev${howOpen ? " is-open" : ""}`, "aria-hidden": "true", html: ICONS.chevronRight }), "How skills work");
    const how = howOpen
      ? m("div", { class: "skl-how" },
          ...HOW_CARDS.map((c) => m("div", { class: "skl-how-card" },
            m("div", { class: "skl-how-t" }, c.title),
            m("p", {}, c.words),
            c.example ? m("p", { class: "skl-how-ex" }, c.example[0], m("code", {}, c.example[1])) : null)),
          m("p", { class: "mcps-hint skl-how-foot" }, HOW_FOOT))
      : null;
    const refocus = () => {
      if (!focusHow) return;
      focusHow = false;
      /** @type {any} */ (howBtn).focus?.();
    };
    if (!mine.length && !data.plugins.length) {
      fill(host, m("div", { class: "skl-bar" }, howBtn), how,
        m("div", { class: "mcps-empty skl-empty" }, m("p", {}, emptyWords(found)), m("div", { class: "skl-acts" }, btn(m, "Add skills…", "default", () => void openAdd(), { html: ICONS.plus }), newBtn())));
      refocus();
      return;
    }
    // Typing filters the rows alone: the field stays where it is, so it keeps the focus and the next letter (Hunter's
    // find: the whole list was painted again, field and all, on each letter). Two sections (Product's mock A): the
    // skills always on at the place, what their lines cost every message, and those a tag loads.
    const rows = m("div", { class: "skl-rows" });
    const at = scope === "all" ? "all chats" : placeName;
    const paintRows = () => {
      // A name searched as the rows show it, its tag, finds it.
      const words = filter.trim().toLowerCase().replace(/^\$/, "");
      const shown = words ? mine.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(words)) : mine;
      const allOn = mine.filter((s) => !!s.on?.on);
      const on = shown.filter((s) => !!s.on?.on);
      const off = shown.filter((s) => !s.on?.on);
      if (!mine.length) return fill(rows, m("p", { class: "mcps-empty" }, emptyWords(found)));
      if (!shown.length) return fill(rows, m("p", { class: "mcps-quiet" }, "None of your skills holds those words."));
      const head = (/** @type {string} */ title, /** @type {any} */ sub) => m("div", { class: "skl-sec-h" }, m("span", { class: "mcps-h" }, title), sub ? m("span", { class: "mcps-sub" }, sub) : null);
      fill(rows,
        on.length || !words
          ? m("div", { class: "skl-sec", "data-sec": "on" },
              head(`Always on in ${at}`, onWords(allOn.length, allOn.reduce((n, s) => n + (Number(s.lineTokens) || 0), 0))),
              on.length ? m("div", { class: "mcps-rows" }, ...on.map(rowEl)) : m("p", { class: "mcps-empty skl-none" }, NONE_ON))
          : null,
        off.length
          ? m("div", { class: "skl-sec", "data-sec": "tag" },
              head("Tag when you need them", m("span", {}, "They cost nothing until you tag one, like ", m("code", {}, `$${off[0].name}`))),
              m("div", { class: "mcps-rows" }, ...off.map(rowEl)))
          : null);
    };
    const field = m("input", { class: "zc-input skl-filter", type: "search", placeholder: "Search your skills", "aria-label": "Search your skills", value: filter, oninput: (/** @type {any} */ e) => { filter = String(e.target.value || ""); paintRows(); } });
    paintRows();
    fill(host,
      data.count > data.most ? m("p", { class: "mcps-unread" }, overWords(scope === "all" ? "All chats" : placeName, data.count, data.most)) : null,
      m("div", { class: "skl-bar" }, howBtn, m("span", { class: "lib-gap" }), mine.length ? field : null),
      how,
      rows,
      ...data.plugins.map(pluginEl));
    refocus();
  }

  /**
   * Add skills… (the Designer's): what the coding agents keep on this computer, none ticked — one already yours shown as
   * such, one whose name another has said so —, and a folder or git address. Add sends the folders ticked, then the
   * address. What it adds is on nowhere: a tag loads it, and its switch turns it on (Product's mock A of 11-07).
   */
  async function openAdd() {
    const picked = new Set();
    const list = m("div", { class: "mcps-imp" }, m("p", { class: "mcps-quiet" }, "Looking on this computer…"));
    const input = /** @type {HTMLInputElement} */ (m("input", { class: "zc-input skl-from", type: "text", spellcheck: "false", placeholder: `${pathExample(state.platform, "skills/unity", "C")}  or  https://github.com/owner/skills`, "aria-label": "A folder or a git address", oninput: () => paintCount() }));
    const dirs = m("div", { class: "browse-dirs hidden" });
    const error = m("p", { class: "mcps-error", role: "alert" });
    const count = m("span", { class: "mcps-says" });
    const addBtn = btn(m, "Add", "default", () => void add(), { disabled: true });
    const body = m("div", { class: "mcps-sheet" },
      m("h4", { class: "mcps-h" }, "Found on this computer"),
      m("p", { class: "mcps-hint" }, "Your agents keep these for themselves. Each still loads its own; added here, every agent gets it."),
      list,
      m("h4", { class: "mcps-h" }, "From a folder or git"),
      m("div", { class: "skl-from-row" }, input, m("button", { class: "ghost sm", type: "button", onclick: () => void (io.browse || browseFolder)(input, /** @type {any} */ (dirs), (w) => toast(w, "err")) }, "Browse…")),
      dirs,
      m("p", { class: "mcps-hint" }, "A folder stays where it is: Filament reads it there, so your edits show. A git address is copied into Filament; Update fetches it again."),
      error,
      m("div", { class: "mcps-sheet-foot" }, count, btn(m, "Cancel", "outline", () => d.close()), addBtn));
    const d = openDialog({ title: "Add skills", description: "Into your skills: a tag loads one when you need it, and its switch turns it on for chats that should always have it.", glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.wandSparkles }), body, wide: true });

    function paintCount() {
      const typed = String(input.value || "").trim();
      const n = picked.size;
      count.replaceChildren(n ? `${n} to add` : typed ? "" : "Tick the skills to add, or name a folder or a git address");
      addBtn.querySelector?.(".zc-btn-label")?.replaceChildren?.(n > 1 ? `Add ${n}` : "Add");
      if (n || typed) addBtn.removeAttribute("disabled");
      else addBtn.setAttribute("disabled", "");
    }

    /** @type {any[]} */
    let agents = [];
    try {
      agents = (await call(`/skills/found?place=${encodeURIComponent(scope)}`)).agents || [];
    } catch (e) {
      list.replaceChildren(m("p", { class: "mcps-failed" }, errText(e)));
    }
    /** @param {any} f */
    const foundRow = (f) => {
      const can = !f.added && !f.clash;
      const tick = can
        ? m("input", { type: "checkbox", class: "mrow-tick", "aria-label": `Add ${f.name}`, onchange: (/** @type {any} */ e) => { if (e.target.checked) picked.add(f.path); else picked.delete(f.path); paintCount(); } })
        : m("span", { class: "mcps-imp-gap", "aria-hidden": "true" });
      const note = f.added ? "In your skills already." : f.clash ? `Another skill is named ${f.clash}: this one would be left out.` : "";
      return m("div", { class: `mcps-row${can ? "" : " is-off"}`, "data-name": f.name },
        tick,
        m("div", { class: "mcps-text" },
          m("div", { class: "mcps-label" }, m("span", { class: "mcps-name" }, f.name)),
          f.description ? m("div", { class: "mcps-sub skl-desc", title: f.description }, f.description) : null,
          note ? m("div", { class: "mcps-sub" }, note) : null));
    };
    if (agents.length) {
      const groups = agents.filter((a) => a.skills.length);
      list.replaceChildren(...(groups.length ? groups.map((a) => {
        const free = a.skills.filter((/** @type {any} */ f) => !f.added && !f.clash);
        const rows = m("div", { class: "mcps-rows" }, ...a.skills.map(foundRow));
        const tickAll = free.length > 1 ? btn(m, "Tick all", "ghost", () => {
          for (const f of free) picked.add(f.path);
          for (const box of /** @type {any[]} */ (Array.from(/** @type {any} */ (rows).querySelectorAll?.("input.mrow-tick") || []))) box.checked = true;
          paintCount();
        }) : null;
        // The folders it keeps them in, from the home folder; never a synced copy's own folder.
        const folder = (a.where || []).join(" · ");
        return m("div", { class: "mcps-imp-app" },
          m("div", { class: "mcps-imp-head" }, m("span", { class: "mcps-name" }, a.label), m("span", { class: "mcps-sub" }, `${a.skills.length} · ${folder}`), m("span", { class: "lib-gap" }), tickAll),
          rows);
      }) : [m("p", { class: "mcps-quiet" }, "Claude Code, Codex and Cursor keep no skills on this computer.")]));
    }
    paintCount();

    async function add() {
      const typed = String(input.value || "").trim();
      addBtn.setAttribute("disabled", "");
      error.replaceChildren("");
      /** @type {string[]} */
      const added = [];
      /** @type {string[]} */
      const skipped = [];
      const take = (/** @type {any} */ r) => {
        added.push(...(r.added || []).map((/** @type {any} */ s) => s.name));
        skipped.push(...(r.skipped || []).map((/** @type {any} */ s) => `${s.name || s.path}: ${s.why}`));
      };
      try {
        // The place rides for where a folder came from (a project's own .claude/skills is Claude Code's); `on: false`
        // turns nothing on there.
        if (picked.size) take(await call("/skills", { method: "POST", body: { paths: [...picked], place: scope, on: false } }));
        if (typed) {
          const git = /^(https?:\/\/|ssh:\/\/|git@)/.test(typed) || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(typed);
          take(await call("/skills", { method: "POST", body: git ? { git: typed } : { paths: [typed], place: scope, on: false } }));
        }
      } catch (e) {
        error.replaceChildren(errText(e));
        paintCount();
        if (!added.length) return;
      }
      d.close();
      // One toast: the harness keeps one at a time, so a second would take the first's place.
      const done = added.length ? `${added.length === 1 ? `${added[0]} is added: tag it as $${added[0]}` : `${added.length} skills are added: tag one with $ and its name`} when you need it.` : "";
      const left = skipped.length ? `Not added: ${skipped.join("; ")}` : "";
      if (done || left) toast([done, left].filter(Boolean).join(" "), left && !done ? "err" : "");
      found = null;
      await refresh();
    }
  }

  /**
   * New skill… (the Designer's of 10-27): a skill made in Filament — written on its page, given books there. It starts
   * on nowhere: an empty skill sits in no chat's list until it is turned on.
   */
  function openNew() {
    openNewSkill({ h: m, api: call, dialog: openDialog, toast }, (name) => go(routeFor("library", { page: "skills", scope: name })));
  }
}

/**
 * New skill…: a name and what it is for, made on nowhere. `made` is what follows once it is: the list opens its page,
 * Add to skill… picks it — one way to make a skill wherever it is asked for.
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, dialog?: typeof dialog, toast: (msg: string, kind?: string) => void }} o
 * @param {(name: string) => void} made
 */
export function openNewSkill(o, made) {
  const m = o.h || h;
  const call = o.api || api;
  const openDialog = o.dialog || dialog;
  const nameIn = /** @type {HTMLInputElement} */ (m("input", { class: "zc-input", type: "text", spellcheck: "false", placeholder: "release-checks", "aria-label": "Name", oninput: () => check() }));
  const forIn = /** @type {HTMLTextAreaElement} */ (m("textarea", { class: "zc-input mcps-note", rows: "3", "aria-label": "What it is for" }));
  const error = m("p", { class: "mcps-error", role: "alert" });
  const makeBtn = btn(m, "Make skill", "default", () => void make(), { disabled: true });
  const field = (/** @type {string} */ k, /** @type {HTMLElement} */ input, /** @type {string} */ hint) => m("div", { class: "mcps-field" }, m("span", { class: "mcps-k" }, k), m("div", { class: "mcps-v" }, input, m("span", { class: "mcps-hint" }, hint)));
  const body = m("div", { class: "mcps-sheet" },
    m("div", { class: "mcps-fields" },
      field("Name", nameIn, "How you tag it: $release-checks. Letters, digits, . _ and -."),
      field("What it is for", forIn, "Agents see this line wherever it is on, and use the skill when a request matches it — say what its books cover.")),
    error,
    m("div", { class: "mcps-sheet-foot" }, btn(m, "Cancel", "outline", () => d.close()), makeBtn));
  const d = openDialog({ title: "New skill", description: "Made in Filament: you write it here and give it books to look things up in.", glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.wandSparkles }), body });
  function check() {
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(nameIn.value || "").trim())) makeBtn.removeAttribute("disabled");
    else makeBtn.setAttribute("disabled", "");
  }
  async function make() {
    const name = String(nameIn.value || "").trim();
    makeBtn.setAttribute("disabled", "");
    try {
      await call("/skills", { method: "POST", body: { make: name, description: String(forIn.value || "").trim() } });
    } catch (e) {
      error.replaceChildren(errText(e));
      check();
      return;
    }
    d.close();
    o.toast(`${name} is made. It is on nowhere: a message that tags it as $${name} has the agent load it.`);
    made(name);
  }
}

/**
 * A skill's page: where it came from, where it is on (Change…), what it costs a request, its files beside the one shown;
 * one made in Filament is written here, and carries its Books.
 * @param {HTMLElement} body
 * @param {string} name
 * @param {{ onToast?: (msg: string, kind?: string) => void, head?: (title: string, line: string) => void, acts?: HTMLElement | null, onCraft?: (skill: string) => void }} [cb]
 *   `onCraft`: Craft it in a chat… — the skill's crafter chat, opened (app/crafter-chats.js)
 * @param {SkillsIo} [io]
 */
export function renderSkillPage(body, name, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openDialog = io.dialog || dialog;
  const confirm = io.confirm || confirmDialog;
  const go = io.go || ((/** @type {string} */ hash) => { location.hash = hash; });
  const toast = (/** @type {string} */ msg, /** @type {string} */ kind = "") => cb.onToast?.(msg, kind || undefined);
  /** @type {any} */
  let s = null;
  let shown = "SKILL.md";
  /** The Files list's folders opened. @type {Set<string>} */
  const opened = new Set();
  /** The books just added, lit a moment. @type {Set<string>} */
  let lit = new Set();
  const viewer = m("div", { class: "skl-view" });
  const fileList = m("div", { class: "skl-files", role: "list", "aria-label": "Files" });
  body.replaceChildren(m("p", { class: "mcps-quiet" }, "Reading the skill…"));
  void load();

  async function load() {
    try {
      s = await call(`/skills/${encodeURIComponent(name)}`);
    } catch (e) {
      body.replaceChildren(m("p", { class: "mcps-failed" }, errText(e)), btn(m, "Back to Skills", "outline", () => go(routeFor("library", { page: "skills" }))));
      return;
    }
    cb.head?.(s.name, s.description || "");
    fill(cb.acts,
      s.kind === "git" ? btn(m, "Update", "outline", () => void update(), { html: ICONS.refreshCw }) : null,
      s.kind !== "shipped" ? btn(m, "Remove…", "ghost", () => void remove(), { html: ICONS.trash2 }) : null);
    paint();
    await show(shown);
  }

  function paint() {
    const on = /** @type {any[]} */ (s.places || []).filter((p) => p.on);
    const where = on.length
      ? m("div", { class: "skl-where" }, m("span", { class: "skl-where-k" }, "Always on in"), m("span", {}, on.map((p) => p.label === "all chats" ? "All chats" : p.label).join(" · ")), m("span", { class: "lib-gap" }), btn(m, "Change…", "outline", () => void openPlaces()))
      : m("div", { class: "skl-where" }, m("span", {}, `Always on nowhere: tag it as $${s.name} in a message when you need it.`), m("span", { class: "lib-gap" }), btn(m, "Turn on for…", "default", () => void openPlaces()));
    paintFiles();
    // A made skill's foot would repeat its From line; the others say why there is no Edit.
    const foot = s.kind === "git" ? "Read-only here: it is Filament's copy of its repository." : s.kind === "shipped" ? "Comes with Filament: read-only." : s.kind === "made" ? "" : "Read-only here: change it in its folder.";
    fill(body,
      m("p", { class: "skl-from-line" }, fromLine(s)),
      s.there ? null : m("p", { class: "mcps-failed" }, `Its folder is gone (${s.path}): no chat gets it until it is back.`),
      where,
      m("p", { class: "mcps-hint" }, `Every request where it is on: about ${s.lineTokens} tokens; the rest loads only when it is used.`),
      s.kind === "made" ? booksEl() : null,
      m("div", { class: "skl-panes" }, fileList, viewer),
      foot ? m("p", { class: "mcps-hint" }, foot) : null);
  }

  /** The Files list: a folder of many files folded into one row until it is opened. */
  function paintFiles() {
    fill(fileList,
      m("div", { class: "skl-files-h" }, "Files"),
      ...filesShown(s.files || [], opened).map((f) => f.folded
        ? m("button", { class: "skl-file is-dir is-fold", type: "button", role: "listitem", title: `Show the ${f.folded} files of ${f.path}/`, onclick: () => { opened.add(f.path); paintFiles(); } }, m("span", { class: "skl-file-n" }, `${f.path.split("/").at(-1)}/`), m("span", { class: "skl-file-c" }, ` · ${f.folded}`))
        : f.dir
          ? m("div", { class: "skl-file is-dir", role: "listitem" }, `${f.path}/`)
          : m("button", { class: `skl-file${f.path === shown ? " on" : ""}`, type: "button", role: "listitem", title: f.path, onclick: () => void show(f.path) }, f.path.split("/").at(-1))),
      s.more ? m("div", { class: "skl-file is-dir" }, "…and more") : null);
  }

  /** Files dropped on an element: its ring while they are over it, `take` when they land. @param {HTMLElement} el @param {(files: any[]) => void} take */
  function dropOn(el, take) {
    el.addEventListener("dragover", (/** @type {any} */ e) => { e.preventDefault?.(); el.classList.add("is-over"); });
    el.addEventListener("dragleave", () => el.classList.remove("is-over"));
    el.addEventListener("drop", (/** @type {any} */ e) => {
      e.preventDefault?.();
      el.classList.remove("is-over");
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) take(files);
    });
    return el;
  }

  /** Books (the Designer's of 10-27): a made skill's PDFs, Markdown and text files, each a row; files dropped here open Add books…. */
  function booksEl() {
    const books = /** @type {any[]} */ (s.books || []);
    const parts = books.reduce((n, b) => n + b.parts.length, 0);
    const row = (/** @type {any} */ b) => {
      const warn = noTextLine(b);
      // A few blank pages are any book's; past NO_TEXT_LOUD of them it is said in the warning's colour.
      const loud = (b.noText?.length || 0) > Math.max(NO_TEXT_LOUD.pages, (b.pages || 0) * NO_TEXT_LOUD.share);
      return m("div", { class: `mcps-row${lit.has(b.id) ? " is-lit" : ""}`, "data-book": b.id },
        m("div", { class: "mcps-text" },
          m("div", { class: "mcps-label" }, m("button", { class: "skl-name", type: "button", title: "Its parts in references/INDEX.md", onclick: () => void showBook(b) }, b.name)),
          m("div", { class: "mcps-sub" }, bookLine(b)),
          warn ? m("div", { class: `mcps-sub${loud ? " is-warn" : ""}` }, warn) : null),
        m("span", { class: "mcps-ctl" }, m("button", { class: "mcps-x", type: "button", title: `Remove ${b.name}…`, "aria-label": `Remove ${b.name}…`, html: ICONS.trash2, onclick: () => void removeBook(b) })));
    };
    return dropOn(m("div", { class: "skl-sec skl-books skl-drop" },
      m("div", { class: "skl-sec-h" },
        m("span", { class: "mcps-h" }, "Books"),
        books.length ? m("span", { class: "mcps-sub" }, `${count(books.length, "book")} · ${count(parts, "part")}`) : null,
        m("span", { class: "lib-gap" }),
        cb.onCraft ? btn(m, "Craft it in a chat…", "outline", () => cb.onCraft?.(s.name), { html: ICONS.wandSparkles, title: "A chat of its own where an agent crafts this skill from its books and whatever else you give it, the web too — you watch every step and steer it. Its crafter chat opens again where it has one." }) : null,
        btn(m, "Add books…", "outline", () => void openAddBooks([]), { html: ICONS.plus })),
      books.length
        ? m("div", { class: "mcps-rows" }, ...books.map(row))
        : m("p", { class: "mcps-empty" }, "No books yet. Add a PDF, a Markdown or text file, or a folder of them — a manual, a standard, your notes. Each is split by its chapters or headings, and agents look up what they need in it, with the page."),
      books.length ? m("p", { class: "mcps-hint" }, "Agents search the parts by words and read only the passage they need, with its book, chapter and page. A book costs a request nothing until then.") : null), (files) => void openAddBooks(files));
  }

  /** A book's parts: the table of contents, at its heading. @param {any} b */
  async function showBook(b) {
    await show("references/INDEX.md");
    const head = /** @type {any[]} */ (Array.from(/** @type {any} */ (viewer).querySelectorAll?.("h2") || [])).find((x) => String(x.textContent || "").trim() === b.title);
    head?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  /** @param {any} b */
  async function removeBook(b) {
    if (!(await confirm({ title: `Remove ${b.name}?`, description: `Its ${count(b.parts.length, "part")} and Filament's copy of it go; agents can no longer look anything up in it. Your own file stays where it is.`, confirmLabel: "Remove", destructive: true }))) return;
    try {
      await call(`/skills/${encodeURIComponent(s.name)}/books/${encodeURIComponent(b.id)}`, { method: "DELETE" });
      toast(`${b.name} is removed from ${s.name}'s books.`);
    } catch (e) {
      toast(errText(e), "err");
    }
    if (shown.startsWith(`references/${b.id}/`) || shown.startsWith(`sources/${b.id}`)) shown = "SKILL.md";
    await load();
  }

  /**
   * Add books… (the Designer's of 10-27): files dropped or chosen, each sent on its own so the count is true, or a path
   * on this computer read where it is. All added, a toast and the page; any not, the dialog says which and why.
   * @param {any[]} pre  files dropped on the page
   */
  function openAddBooks(pre) {
    /** @type {{ file: any, name: string, size: number, bad: string }[]} */
    const picked = [];
    let changed = false;
    const fileInput = /** @type {HTMLInputElement} */ (m("input", { type: "file", class: "hidden", multiple: "", accept: ".pdf,.md,.markdown,.txt", "aria-label": "Choose files", onchange: (/** @type {any} */ e) => { take(Array.from(e.target.files || [])); e.target.value = ""; } }));
    const box = m("div", { class: "skl-pick" });
    const pathIn = /** @type {HTMLInputElement} */ (m("input", { class: "zc-input skl-from", type: "text", spellcheck: "false", placeholder: `${pathExample(state.platform, "Books/release-it.pdf", "C")}  or  ${pathExample(state.platform, "Books", "C")}`, "aria-label": "A file or folder on this computer", oninput: () => paintSays() }));
    const dirs = m("div", { class: "browse-dirs hidden" });
    const error = m("p", { class: "mcps-error", role: "alert" });
    const says = m("span", { class: "mcps-says" });
    const addBtn = btn(m, "Add", "default", () => void add(), { disabled: true });
    const foot = m("div", { class: "mcps-sheet-foot" }, says, btn(m, "Cancel", "outline", () => d.close()), addBtn);
    const sheet = m("div", { class: "mcps-sheet skl-add" },
      s.readsPdf === false ? m("p", { class: "mcps-warn" }, "This computer has no pdftotext, so PDFs can't be added — Git for Windows ships it; elsewhere it comes with poppler. Markdown and text files can.") : null,
      box, fileInput,
      m("h4", { class: "mcps-h" }, "Or a file or folder on this computer"),
      m("div", { class: "skl-from-row" }, pathIn, m("button", { class: "ghost sm", type: "button", onclick: () => void (io.browse || browseFolder)(pathIn, /** @type {any} */ (dirs), (w) => toast(w, "err")) }, "Browse…")),
      dirs,
      m("p", { class: "mcps-hint" }, "A folder: each PDF in it becomes a book, and its Markdown and text files together one. Use this for files over 45 MB too."),
      m("p", { class: "mcps-hint" }, `Each is split by its chapters or headings — a PDF without them, every ${s.pagesPerPart || 20} pages — and Filament keeps a copy of it. A scanned PDF has no text: Filament does no OCR, so it can't be added.`),
      error, foot);
    const d = openDialog({ title: "Add books", description: `Into ${s.name} · agents look things up in them`, glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.bookOpen }), body: sheet, wide: true, onClose: () => { if (changed) void load(); } });
    take(pre);

    /** Files chosen or dropped: each kept, or said why it can't be sent. @param {any[]} files */
    function take(files) {
      for (const f of files) {
        const name = String(f?.name || "");
        if (!name || picked.some((p) => p.name === name)) continue;
        const bad = !BOOK_ENDINGS.test(name) ? "Filament reads PDF, Markdown and text files only." : Number(f.size) > SEND_BYTES_MAX ? "Over 45 MB: too big to send from the page. Give its path below instead." : "";
        picked.push({ file: f, name, size: Number(f.size) || 0, bad });
      }
      paintBox();
    }
    function paintBox() {
      const choose = (/** @type {string} */ label) => m("button", { class: "ghost sm", type: "button", onclick: () => fileInput.click() }, label);
      if (!picked.length) box.replaceChildren(dropOn(m("div", { class: "mcps-empty skl-drop" }, m("span", {}, "Drop PDF, Markdown or text files here, or "), choose("Choose files…")), take));
      else
        box.replaceChildren(
          dropOn(m("div", { class: "mcps-rows skl-drop" }, ...picked.map((p) => m("div", { class: `mcps-row${p.bad ? " is-off" : ""}` },
            m("div", { class: "mcps-text" },
              m("div", { class: "mcps-label" }, m("span", { class: "mcps-name" }, p.name)),
              m("div", { class: `mcps-sub${p.bad ? " is-bad" : ""}` }, p.bad || `${/\.pdf$/i.test(p.name) ? "PDF" : /\.txt$/i.test(p.name) ? "Text" : "Markdown"} · ${sizeWords(p.size)}`)),
            m("span", { class: "mcps-ctl" }, m("button", { class: "mcps-x", type: "button", title: `Leave out ${p.name}`, "aria-label": `Leave out ${p.name}`, html: ICONS.x, onclick: () => { picked.splice(picked.indexOf(p), 1); paintBox(); } }))))), take),
          choose("Choose more…"));
      paintSays();
    }
    function paintSays() {
      const n = picked.filter((p) => !p.bad).length;
      const typed = String(pathIn.value || "").trim();
      says.replaceChildren(n && typed ? `${count(n, "book")} and what the path holds to add` : n ? `${count(n, "book")} to add` : typed ? "What the path holds to add" : "Choose files, drop them here, or give a path.");
      if (n || typed) addBtn.removeAttribute("disabled");
      else addBtn.setAttribute("disabled", "");
    }

    async function add() {
      const good = picked.filter((p) => !p.bad);
      const typed = String(pathIn.value || "").trim();
      const total = good.length + (typed ? 1 : 0);
      addBtn.setAttribute("disabled", "");
      addBtn.querySelector?.(".zc-btn-label")?.replaceChildren?.("Adding…");
      error.replaceChildren("");
      /** @type {{ name: string, book?: any, why?: string }[]} */
      const results = [];
      const collect = (/** @type {any} */ r) => {
        for (const b of r.added || []) results.push({ name: b.name, book: b });
        for (const x of r.skipped || []) results.push({ name: x.name, why: x.why });
      };
      let i = 0;
      let failed = "";
      try {
        for (const p of good) {
          i++;
          says.replaceChildren(`Reading ${p.name} (${i} of ${total})… a long PDF takes a few seconds.`);
          const data = await (io.base64 || fileBase64)(p.file);
          collect(await call(`/skills/${encodeURIComponent(s.name)}/books`, { method: "POST", body: { files: [{ name: p.name, data }] } }));
        }
        if (typed) {
          i++;
          says.replaceChildren(`Reading ${typed.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || typed}${total > 1 ? ` (${i} of ${total})` : ""}… a long PDF takes a few seconds.`);
          collect(await call(`/skills/${encodeURIComponent(s.name)}/books`, { method: "POST", body: { paths: [typed] } }));
        }
      } catch (e) {
        failed = errText(e);
        error.replaceChildren(failed);
      }
      const added = results.filter((r) => r.book);
      changed = changed || added.length > 0;
      if (!results.some((r) => r.why) && !failed) {
        lit = new Set(added.map((r) => r.book.id));
        d.close();
        const parts = added.reduce((n, r) => n + r.book.parts.length, 0);
        toast(added.length === 1 ? `Added ${added[0].name} to ${s.name}: ${partsWords(added[0].book)}.` : `Added ${count(added.length, "book")} to ${s.name}: ${count(parts, "part")}.`);
        setTimeout(() => { lit = new Set(); for (const el of /** @type {any[]} */ (Array.from(/** @type {any} */ (body).querySelectorAll?.(".skl-books .is-lit") || []))) el.classList?.remove("is-lit"); }, 2400);
        return;
      }
      if (!results.length) {
        addBtn.querySelector?.(".zc-btn-label")?.replaceChildren?.("Add");
        paintSays();
        return;
      }
      // Some were not added: the dialog becomes what happened, file by file.
      lit = new Set(added.map((r) => r.book.id));
      fill(sheet,
        m("h4", { class: "mcps-h" }, `Added ${added.length} of ${results.length}`),
        m("div", { class: "mcps-rows" }, ...results.map((r) => m("div", { class: `mcps-row${r.book ? "" : " is-off"}` },
          m("div", { class: "mcps-text" },
            m("div", { class: "mcps-label" }, m("span", { class: "mcps-name" }, r.name)),
            m("div", { class: `mcps-sub${r.book ? "" : " is-bad"}` }, r.book ? bookLine(r.book) : `Not added: ${r.why}`))))),
        error,
        m("div", { class: "mcps-sheet-foot" }, btn(m, "Done", "default", () => d.close())));
    }
  }

  /** One file in the viewer: Markdown drawn, another text as it is, one that is not text said. @param {string} path */
  async function show(path) {
    shown = path;
    for (const b of /** @type {any[]} */ (Array.from(/** @type {any} */ (body).querySelectorAll?.(".skl-file") || []))) b.classList?.toggle("on", b.getAttribute?.("title") === path);
    let text = "";
    let size = 0;
    if (path === "SKILL.md") {
      text = String(s.text || "");
      size = Number((s.files || []).find((/** @type {any} */ f) => f.path === "SKILL.md")?.size) || text.length;
    } else
      try {
        const r = await call(`/skills/${encodeURIComponent(s.name)}/file?path=${encodeURIComponent(path)}`);
        // Another file picked while this one was read: that one's, not this (Hunter's find).
        if (shown !== path) return;
        text = String(r.text || "");
        size = Number(r.size) || text.length;
      } catch (e) {
        if (shown !== path) return;
        viewer.replaceChildren(m("div", { class: "skl-view-h" }, path), m("p", { class: "mcps-quiet" }, `${errText(e)} Open it in its folder: ${s.path}`));
        return;
      }
    // A SKILL.md past what the page reads is shown from its start and not edited here: a Save would keep only that much
    // (Hunter's find).
    const edit = path === "SKILL.md" && s.kind === "made" && !s.cut ? btn(m, "Edit", "ghost", () => editSkill(), { html: ICONS.pencil }) : null;
    const md = /\.md$/i.test(path);
    viewer.replaceChildren(
      m("div", { class: "skl-view-h" }, m("span", {}, `${path} · ${sizeWords(size)}`), m("span", { class: "lib-gap" }), edit),
      ...(path === "SKILL.md" && s.cut ? [m("p", { class: "mcps-quiet" }, `It is longer than the page reads: its start is shown, and it is edited in its folder — ${s.path}`)] : []),
      md ? m("div", { class: "skl-md", html: mdDoc(path === "SKILL.md" ? bodyOf(text) : text, "skill") }) : m("pre", { class: "skl-pre" }, text));
  }

  /** A made skill's SKILL.md written in place: Save keeps it, Cancel leaves it. */
  function editSkill() {
    const area = /** @type {HTMLTextAreaElement} */ (m("textarea", { class: "zc-input skl-edit", rows: "22", spellcheck: "false", "aria-label": `${s.name}'s SKILL.md` }));
    area.value = String(s.text || "");
    const error = m("p", { class: "mcps-error", role: "alert" });
    viewer.replaceChildren(
      m("div", { class: "skl-view-h" }, m("span", {}, "SKILL.md"), m("span", { class: "lib-gap" }),
        btn(m, "Cancel", "outline", () => void show("SKILL.md")),
        btn(m, "Save", "default", async () => {
          try {
            await call(`/skills/${encodeURIComponent(s.name)}/file`, { method: "PUT", body: { path: "SKILL.md", text: area.value } });
            toast(`${s.name}'s SKILL.md is saved. Chats where it is on get it from their next message.`);
            await load();
          } catch (e) {
            error.replaceChildren(errText(e));
          }
        })),
      area, error);
  }

  async function update() {
    try {
      const r = await call(`/skills/${encodeURIComponent(s.name)}/update`, { method: "POST", body: {} });
      toast(updatedWords(s.name, r));
    } catch (e) {
      toast(errText(e), "err");
    }
    await load();
  }

  async function remove() {
    if (!(await confirm({ title: `Remove ${s.name} from Filament?`, description: `It goes off every chat. ${removeWords(s)}`, confirmLabel: "Remove", destructive: true }))) return;
    try {
      await call(`/skills/${encodeURIComponent(s.name)}`, { method: "DELETE" });
      toast(`${s.name} is removed from Filament.`);
      go(routeFor("library", { page: "skills" }));
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  /** Where it is on: All chats, each Space of yours and each project, a switch each. */
  async function openPlaces() {
    const rows = m("div", { class: "mcps-rows" }, m("p", { class: "mcps-quiet" }, "Reading the places…"));
    const d = openDialog({ title: `Where ${s.name} is on`, description: "A chat gets it where it is on, unless its project or the chat turns it off.", body: m("div", { class: "mcps-sheet" }, rows, m("div", { class: "mcps-sheet-foot" }, btn(m, "Done", "default", () => d.close()))), wide: false, onClose: () => void load() });
    /** @type {{ place: string, label: string }[]} */
    let places = [{ place: "all", label: "All chats" }];
    try {
      const [r, own] = await Promise.all([call("/memory/projects"), call("/spaces/own").catch(() => null)]);
      const known = (r?.projects || []).filter((/** @type {any} */ p) => !p.archived);
      const spaces = new Map((own?.spaces || []).map((/** @type {any} */ x) => [String(x.project), String(x.name)]));
      places = [...places, ...known.map((/** @type {any} */ p) => ({ place: `project:${p.id}`, label: spaces.get(String(p.id)) || String(p.name || p.cwd || p.id) }))];
    } catch {}
    const rowOf = async (/** @type {{ place: string, label: string }} */ p) => {
      const at = await call(`/skills/${encodeURIComponent(s.name)}/on?place=${encodeURIComponent(p.place)}`).catch(() => null);
      if (!at) return null;
      const el = m("div", { class: `mcps-row${at.on ? "" : " is-off"}` },
        m("div", { class: "mcps-text" }, m("span", { class: "mcps-name" }, p.label), !at.here && at.on && at.from ? m("span", { class: "mcps-sub" }, at.from === "all" ? "from all chats" : "from its Space") : null),
        switchEl(m, !!at.on, `${s.name} for ${p.label}`, async () => {
          try {
            await call(`/skills/${encodeURIComponent(s.name)}/on`, { method: "POST", body: { place: p.place, on: !at.on } });
            toast(toastWords(s.name, !at.on, p.place === "all" ? "all chats" : p.label, Number(s.lineTokens) || 0));
            const fresh = await rowOf(p);
            if (fresh) el.replaceWith?.(fresh);
          } catch (e) {
            toast(errText(e), "err");
          }
        }));
      return el;
    };
    const els = (await Promise.all(places.map(rowOf))).filter(Boolean);
    rows.replaceChildren(.../** @type {HTMLElement[]} */ (els));
  }
}
