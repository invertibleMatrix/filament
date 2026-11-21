// @ts-check
// Settings › Language servers (the owner's LSP of 11-04): the programs Filament's agents ask about code — where a name is
// defined, what uses it, a file's symbols and its problems — in the chats that have not chosen their own. Every server the
// place's chats have, in the order a file picks among them: yours, your plugins', then the ones Filament knows; each with
// what it runs, whether it is installed on this computer — and how to install it, where Filament knows —, and its
// switch; and a form for one of your own, as Claude Code's .lsp.json writes one. All of it is `lsp.servers` at the place
// "Applies to" picks (settings/place-page.js): a switch `{ name, enabled }`, one of yours a server. The servers and
// whether each is installed are Filament's to say (`GET /api/lsp/servers`, http/admin/lsp.js), read as the page is
// drawn. Built with an injected `h`, `api` and menu, so it runs on the fake DOM.
import { ICONS } from "../lib/icons.js";
import { api } from "../lib/api.js";
import { toggle } from "../lib/fields.js";
import { mountPlacePage } from "./place-page.js";

/** The setting the page writes. */
const LSP = "lsp.servers";
/** The form's fields, each kept as a draft while the page is drawn again. */
const FIELDS = ["name", "command", "args", "files"];

/** Settings search's words for this page (search.js, HS-D68): each row it draws, checked against its code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { label: "Which serves a file", words: "lsp language servers installed found on off switch typescript pyright pylsp gopls rust-analyzer clangd plugin" },
  { label: "Add a server of your own", words: "lsp.json command program extension language id" },
]);

/** A list as the page reads one. @param {unknown} v @returns {any[]} */
const listOf = (v) => (Array.isArray(v) ? v : []);

/**
 * The files a server of yours serves, as typed: each extension with its language id, `.zig zig, .zon zig` (`.zig=zig`
 * too). One with no id is sent as it is, for Filament to say what it lacks.
 * @param {string} text @returns {Record<string, string>}
 */
const filesOf = (text) =>
  Object.fromEntries(String(text).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const pair = /^(\S+?)\s*(?:=|:|\s)\s*(\S+)$/.exec(s);
    return pair ? [pair[1], pair[2]] : [s, ""];
  }));

/**
 * @param {HTMLElement} body
 * @param {import("./place-page.js").PageCallbacks} [cb]
 * @param {import("./place-page.js").PageIo} [io]
 */
export function renderLanguageServers(body, cb = {}, io = {}) {
  mountPlacePage(body, cb, io, {
    say: (project) => (project ? `Chats in ${project.name} take these over yours; its servers add to yours.` : "Every chat that has not chosen its own."),
    rows: languageServerRows,
  });
}

/**
 * The page's rows over one place.
 * @param {import("./place-page.js").Kit} kit @param {import("./place-page.js").Project | null} project
 */
export function languageServerRows(kit, project) {
  const { m, place, cb, io, write, row, head } = kit;
  const here = project ? "This project" : "All chats";
  /** This place's own entries; under a project, all chats' too, which its switches stand over. */
  const own = listOf(place.ownValue(LSP));
  const under = project ? listOf(place.under(LSP)) : [];
  /** @param {any[]} next @param {(ok: boolean) => void} [settle] */
  const keep = (next, settle) => write(next.length ? { patch: { [LSP]: next } } : { unset: [LSP] }, settle);

  return [
    head("The servers"),
    serversRow(),
    head("Your own"),
    addRow(),
  ];

  /**
   * "Which serves a file": every server the place's chats have, as Filament reads them for it — each with whose it is,
   * what it runs and for which files, whether it is installed here, and its switch; one of yours this place holds, its
   * remove.
   */
  function serversRow() {
    const call = io.api || api;
    const list = m("div", { class: "nset-list" }, m("p", { class: "nset-none" }, "Looking for them on this computer…"));
    void Promise.resolve()
      .then(() => call(`/lsp/servers${project ? `?project=${encodeURIComponent(project.id)}` : ""}`))
      .then((/** @type {any} */ r) => {
        const servers = listOf(r?.servers);
        const named = new Set(servers.map((s) => String(s?.name)));
        // A switch of this place's for a server none here is named (its plugin off or gone), so it can be taken away.
        const stray = own.filter((e) => typeof e?.name === "string" && e.command == null && !named.has(e.name));
        list.replaceChildren(m("div", { class: "nset-items" }, ...servers.map(serverItem), ...stray.map(strayItem)));
      }, (/** @type {any} */ e) => list.replaceChildren(m("p", { class: "set-error" }, `The language servers could not be read: ${String(e?.message || e)}`)));
    return row("Which serves a file", "For a file, yours come first, then your plugins', then Filament's own: the first that is on and installed on this computer serves it. Nothing is bundled: install one, and Filament finds it on the PATH.", list, { wide: true });
  }

  /** @param {any} s  a server as Filament reads it for the place */
  function serverItem(s) {
    const name = String(s.name);
    const mine = own.find((e) => e?.name === name);
    const theirs = under.find((e) => e?.name === name);
    const whose = s.from === "yours" ? "Yours" : s.from === "plugin" ? `Plugin ${String(s.plugin || "").split("@")[0]}` : "Filament's";
    const runs = [String(s.command), ...listOf(s.args).map(String)].join(" ");
    const code = (/** @type {string} */ t) => m("code", { class: "nset-code" }, t);
    return m("div", { class: "nset-item", "data-lsp": name },
      m("span", { class: "nset-preset-text" },
        m("span", { class: "nset-preset-name" },
          m("span", { class: "nset-preset-title" }, name),
          m("span", { class: "nset-src" }, whose),
          // Where its switch, or the server itself, is set: this place, or all chats under a project.
          mine ? m("span", { class: "nset-src is-here" }, here) : theirs ? m("span", { class: "nset-src" }, "All chats") : null),
        m("span", { class: "nset-preset-line" }, code(runs), ` · ${listOf(s.files).join(" ")}`),
        m("span", { class: "nset-preset-line" }, ...(s.found ? ["✓ Installed on this computer"] : ["✗ Not installed on this computer", ...(s.install ? [": ", code(String(s.install))] : [])]))),
      toggle(m, s.on === true, name, () => void flip(name, s.on !== true)),
      mine?.command != null
        ? m("button", { class: "nset-x", type: "button", title: `Remove ${name}, yours`, "aria-label": `Remove ${name}`, html: ICONS.x, onclick: () => void keep(own.filter((e) => e !== mine)) })
        : null);
  }

  /** A switch of this place's for a server none here is named. @param {any} e */
  function strayItem(e) {
    const name = String(e.name);
    return m("div", { class: "nset-item", "data-lsp": name },
      m("span", { class: "nset-preset-text" },
        m("span", { class: "nset-preset-name" }, m("span", { class: "nset-preset-title" }, name), m("span", { class: "nset-src is-here" }, here)),
        m("span", { class: "nset-preset-line" }, `Switched ${e.enabled === false ? "off" : "on"} here, but no server here is named ${name}: its plugin is off or gone`)),
      m("button", { class: "nset-x", type: "button", title: `Take away the switch for ${name}`, "aria-label": `Remove ${name}`, html: ICONS.x, onclick: () => void keep(own.filter((x) => x !== e)) }));
  }

  /**
   * A server on or off here. One of yours this place holds keeps its own `enabled`; any other takes this place's switch,
   * and none where the place would have the same without it (all chats' under a project, else on).
   * @param {string} name @param {boolean} on
   */
  function flip(name, on) {
    const mine = own.find((e) => e?.name === name);
    if (mine?.command != null) {
      const server = Object.fromEntries(Object.entries(mine).filter(([k]) => k !== "enabled"));
      return keep(own.map((e) => (e === mine ? (on ? server : { ...server, enabled: false }) : e)));
    }
    const broader = under.find((e) => e?.name === name);
    const without = broader ? broader.enabled !== false : true;
    const rest = own.filter((e) => e !== mine);
    return keep(on === without ? rest : [...rest, { name, enabled: on }]);
  }

  /**
   * "Add a server of your own": its name, the program it runs, its arguments and the files it serves. What is typed
   * outlives the page drawn again, so a refusal leaves it to be put right.
   */
  function addRow() {
    /** @param {string} key @param {string} label @param {string} placeholder */
    const input = (key, label, placeholder) => {
      const f = /** @type {any} */ (m("input", { class: "zc-input nset-in nset-mono", type: "text", placeholder, spellcheck: "false", autocomplete: "off", "aria-label": label, value: kit.drafts.get(`lsp:${key}`) || "" }));
      f.oninput = () => { kit.drafts.set(`lsp:${key}`, String(f.value || "")); };
      f.onkeydown = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } };
      return f;
    };
    /** @type {Record<string, any>} */
    const fields = {
      name: input("name", "Its name", "zls"),
      command: input("command", "The program it runs", "zls, or its whole path"),
      args: input("args", "Its arguments", "none, or --stdio"),
      files: input("files", "The files it serves", ".zig zig, .zon zig"),
    };
    const add = async () => {
      const typed = Object.fromEntries(FIELDS.map((k) => [k, String(fields[k].value || "").trim()]));
      const files = filesOf(typed.files);
      if (!typed.name || !typed.command || !Object.keys(files).length) {
        cb.onToast?.("A server of your own needs its name, the program it runs and the files it serves: each extension with its language id, as .zig zig", "err");
        return;
      }
      if (own.some((e) => e?.name === typed.name && e.command != null)) {
        cb.onToast?.(`${typed.name} is one of yours here already: remove it first`, "err");
        return;
      }
      for (const k of FIELDS) kit.drafts.set(`lsp:${k}`, typed[k]);
      const args = typed.args.split(/\s+/).filter(Boolean);
      // A switch of the same name gives way: the server is on unless it is switched off.
      const server = { name: typed.name, command: typed.command, ...(args.length ? { args } : {}), extensionToLanguage: files };
      await keep([...own.filter((e) => e?.name !== typed.name), server], (ok) => { if (ok) for (const k of FIELDS) kit.drafts.delete(`lsp:${k}`); });
    };
    return row("Add a server of your own", "As Claude Code's .lsp.json writes one: Filament starts it over stdio, in its own environment, when an agent first asks of a file it serves. Named as one of Filament's or a plugin's — typescript, pyright —, it takes that one's place.",
      m("div", { class: "nset-add" }, fields.name, fields.command, fields.args, fields.files,
        m("span", { class: "nset-add-acts" }, m("button", { class: "ghost sm", type: "button", onclick: () => void add() }, "Add"))),
      { wide: true });
  }
}
