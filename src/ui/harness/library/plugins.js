// @ts-check
// Library › Plugins & Connectors (HarnessV4_SpacesPlugins_Plan B5, the Designer's §6 D; Library › Plugins and Library ›
// Connectors until the owner's of 11-09: a plugin brings connectors with its skills, commands and scripts, and a
// connector is an MCP server alone). What is on here first: your connectors, with Applies to, Add connector and Import
// from other apps (settings/mcp-servers.js) — a plugin's own among them, opening its sheet —, then the plugins
// installed here, each with where it is on and an update that waits for you. Then what is found on this computer —
// Claude Code's plugins and Codex's —, each with Add…, which opens the install sheet and installs nothing on the press.
// Then where more come from: Claude Code's marketplaces, Anthropic's directory, Codex's, and the marketplaces you add,
// searched, each plugin with Add…, two to a row where the page is wide. No Settings page: a plugin is turned on from
// its sheet, for all chats, a Space or a project.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { confirmDialog } from "../lib/ui.js";
import { renderMcpServers } from "../settings/mcp-servers.js";
import { pluginSheet } from "./plugin-sheet.js";

/** How many of a source's plugins a page shows at once. */
const PAGE = 30;

/** A source's plugins, its name as the picker says it. @param {any} m @param {string} app */
const marketLabel = (m, app) => `${m.title || m.name} · ${app}${m.count != null ? ` · ${Number(m.count).toLocaleString("en-US")}` : ""}`;

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, open?: string | null, onSetUp?: (place: string, plugin: string, title: string) => void,
 *   connectors?: { at?: boolean, start?: string | null, finish?: { plugin: string, title: string } | null } }} [cb]
 *   `open`: an installed plugin whose sheet opens with the page (`#/library/plugins/<id>`: a connector's row's Open
 *   <plugin>); `onSetUp`: where a plugin's setup goes on — by default the connectors part on its place; `connectors`:
 *   the page opened at its connectors part (`at`: `#/library/connectors`, a Space's or a project's door), on that place
 *   (`start`: "project:<id>"), with a plugin's setup open (`finish`)
 */
export function renderPlugins(body, cb = {}) {
  const toast = cb.onToast || (() => {});
  const serversEl = h("div", { class: "plg-servers" });
  const foundEl = h("div", { class: "plg-found" }, h("p", { class: "set-note" }, "Looking on this computer…"));
  const installedEl = h("div", { class: "plg-installed" });
  const browseEl = h("div", { class: "plg-browse" });
  const connectorsEl = h("section", { class: "plg-sec plg-connectors" }, h("h3", { class: "plg-h" }, "Connectors"), serversEl);
  body.replaceChildren(
    connectorsEl,
    h("section", { class: "plg-sec" }, h("h3", { class: "plg-h" }, "Installed plugins"), installedEl),
    h("section", { class: "plg-sec" }, h("h3", { class: "plg-h" }, "Add from this computer"), foundEl),
    h("section", { class: "plg-sec" }, h("h3", { class: "plg-h" }, "Find more plugins"), browseEl));

  /** @type {any} */
  let sources = null;
  /**
   * The plugins' rows the connectors' list drew last, null before its first draw: where they move — a plugin removed
   * from a place there, another place picked — the plugins installed here are read again, where each is on with them.
   * @type {string | null}
   */
  let pluginRows = null;
  /** @type {ReturnType<typeof renderMcpServers> | null} */
  let servers = null;
  /**
   * The connectors part, on a place (`start`: "project:<id>", else All chats), with a plugin's setup open there.
   * @param {string | null} start @param {{ plugin: string, title: string } | null} finish
   */
  const paintServers = (start, finish) => {
    pluginRows = null;
    servers = renderMcpServers(serversEl, {
      onToast: toast, start, finish,
      // A plugin's connector opens its sheet here, over this page.
      openPlugin: (id) => open({ id }),
      onRows: (rows) => {
        const now = rows.filter((r) => r.plugin).map((r) => `${r.plugin} ${r.name}`).join("\n");
        if (pluginRows !== null && now !== pluginRows) void readInstalled();
        pluginRows = now;
      },
    });
  };
  /**
   * A plugin with a server over the web, installed or turned on at a place: the connectors part on that place, its
   * setup open — a sign-in, a test — (the Designer's of 10-26), scrolled into sight.
   * @param {string} place @param {string} plugin @param {string} title
   */
  const setUp = (place, plugin, title) => {
    paintServers(place === "all" ? null : place, { plugin, title });
    connectorsEl.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };
  /** @param {{ from?: string, name?: string, id?: string }} o */
  const open = (o) => pluginSheet({ ...o, onToast: toast, onDone: () => { void readInstalled(); servers?.refresh(); }, onSetUp: cb.onSetUp || setUp });

  async function readInstalled() {
    try {
      const r = await api("/plugins/installed");
      const list = /** @type {any[]} */ (r?.plugins || []);
      installedEl.replaceChildren(...(list.length
        ? list.map((p) => {
            const on = (p.on || []).filter((/** @type {any} */ w) => w.on).map((/** @type {any} */ w) => w.label);
            return h("button", { class: "plg-row", type: "button", "data-plugin": p.id, onclick: () => open({ id: p.id }) },
              h("span", { class: "plg-row-words" },
                h("b", { class: "plg-row-name" }, p.title || p.name, p.version ? h("span", { class: "sp-quiet plg-version" }, ` ${p.version}`) : null),
                h("span", { class: "sp-quiet plg-row-from" }, `From ${p.origin}`),
                h("span", { class: "plg-row-on" }, on.length ? `On for ${on.join(" · ")}` : "On nowhere yet")),
              p.pending ? h("span", { class: "plg-badge", title: p.pending.words }, "Update waits") : null,
              h("span", { class: "plg-row-open", "aria-hidden": "true" }, "›"));
          })
        : [h("p", { class: "sp-quiet" }, "No plugins yet. Add one from this computer, or find more below.")]));
    } catch (/** @type {any} */ e) {
      installedEl.replaceChildren(h("p", { class: "spc-missing" }, String(e?.message || e)));
    }
  }

  /** What Claude Code and Codex have on this computer, each with Add…. @param {any} f */
  function paintFound(f) {
    const found = [...(f.claude?.installed || []).map((/** @type {any} */ p) => ({ ...p, app: p.from === "claude-desktop" ? "Claude Desktop" : "Claude Code" })), ...(f.codex?.installed || []).filter((/** @type {any} */ p) => p.enabled !== false).map((/** @type {any} */ p) => ({ ...p, app: "Codex" }))];
    const seen = new Set();
    const chips = found.filter((p) => {
      const k = `${p.name}@${p.marketplace}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((p) => h("span", { class: "plg-chip", title: p.description || "" },
      h("b", {}, p.title || p.name), h("span", { class: "sp-quiet" }, ` ${p.app}`),
      p.addFrom
        ? h("button", { class: "ghost sm plg-add", type: "button", onclick: () => open({ from: p.addFrom, name: p.name }) }, "Add…")
        : h("span", { class: "sp-quiet plg-noadd", title: "Its marketplace is not on this computer" }, " · its marketplace is not here")));
    const errors = [f.claude?.error, f.codex?.error, f.directory?.error].filter(Boolean);
    foundEl.replaceChildren(
      h("p", { class: "plg-found-line" }, f.line || "Found on this computer — nothing from Claude Code or Codex."),
      ...(chips.length ? [h("div", { class: "plg-chips" }, ...chips)] : []),
      ...errors.map((e) => h("p", { class: "sp-quiet plg-src-err" }, e)));
  }

  /** Where more come from: a source picked, searched, a page at a time; your marketplaces added and removed. @param {any} f */
  function paintBrowse(f) {
    const options = [
      ...(f.claude?.marketplaces || []).map((/** @type {any} */ m) => ({ id: m.id, label: marketLabel(m, "Claude Code"), m })),
      ...(f.directory?.there && !f.directory.error ? [{ id: "directory", label: `Anthropic's directory · ${Number(f.directory.count).toLocaleString("en-US")}`, m: null }] : []),
      ...(f.codex?.marketplaces || []).map((/** @type {any} */ m) => ({ id: m.id, label: marketLabel(m, "Codex"), m })),
      ...(f.added || []).map((/** @type {any} */ m) => ({ id: m.id, label: marketLabel(m, "yours"), m })),
    ];
    const pick = /** @type {HTMLSelectElement} */ (h("select", { class: "zc-input plg-source", "aria-label": "Where to look" }, ...options.map((o) => h("option", { value: o.id }, o.label))));
    const q = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input plg-q", type: "search", placeholder: "Search by name or words", spellcheck: "false" }));
    const list = h("div", { class: "plg-list" });
    const more = h("button", { class: "ghost sm", type: "button", hidden: "" }, "More");
    const srcActs = h("span", { class: "plg-src-acts" });
    let offset = 0;
    let ask = 0;
    /** @param {boolean} [again] */
    async function read(again = false) {
      if (!pick.value) return void list.replaceChildren(h("p", { class: "sp-quiet" }, "No marketplace is on this computer yet. Add one."));
      const mine = ++ask;
      if (!again) offset = 0;
      try {
        const r = await api(`/plugins/entries?id=${encodeURIComponent(pick.value)}&q=${encodeURIComponent(q.value.trim())}&limit=${PAGE}&offset=${offset}`);
        if (mine !== ask) return;
        const rows = (r?.plugins || []).map((/** @type {any} */ p) => {
          const desc = String(p.description || p.summary || "");
          const from = [p.where, ...(p.installedIn?.length ? [`in ${p.installedIn.join(" and ")}`] : [])].filter(Boolean).join(" · ");
          // Its words two lines at most and where it comes from on one (library.css), each whole on hover.
          return h("div", { class: "plg-entry", "data-name": p.name },
            h("span", { class: "plg-row-words" },
              h("b", {}, p.title || p.name, p.version ? h("span", { class: "sp-quiet plg-version" }, ` ${p.version}`) : null),
              desc ? h("span", { class: "plg-entry-desc", title: desc }, desc) : null,
              from ? h("span", { class: "sp-quiet plg-entry-from", title: from }, from) : null),
            h("button", { class: "ghost sm plg-add", type: "button", onclick: () => open({ from: pick.value, name: p.name }) }, "Add…"));
        });
        if (again) list.append(...rows);
        else list.replaceChildren(...(rows.length ? rows : [h("p", { class: "sp-quiet" }, q.value.trim() ? "Nothing matches." : "It lists no plugin.")]));
        offset += rows.length;
        more.hidden = offset >= Number(r?.total || 0);
      } catch (/** @type {any} */ e) {
        if (mine === ask) list.replaceChildren(h("p", { class: "spc-missing" }, String(e?.message || e)));
      }
    }
    const paintActs = () => {
      const o = options.find((x) => x.id === pick.value);
      srcActs.replaceChildren(...(o?.id.startsWith("added/")
        ? [
            h("button", { class: "ghost sm", type: "button", onclick: async () => {
              try {
                await api(`/plugins/marketplaces/${encodeURIComponent(o.id)}/refresh`, { method: "POST", body: {} });
                toast(`${o.m?.title || "It"} is up to date.`);
                void read();
              } catch (/** @type {any} */ e) { toast(String(e?.message || e), "err"); }
            } }, "Refresh"),
            h("button", { class: "ghost sm", type: "button", onclick: async () => {
              if (!(await confirmDialog({ title: `Remove ${o.m?.title || "this marketplace"}?`, description: "Filament's copy of its list goes. Plugins installed from it stay installed.", confirmLabel: "Remove", destructive: true }))) return;
              try {
                await api(`/plugins/marketplaces/${encodeURIComponent(o.id)}`, { method: "DELETE" });
                await readSources();
              } catch (/** @type {any} */ e) { toast(String(e?.message || e), "err"); }
            } }, "Remove"),
          ]
        : []));
    };
    pick.addEventListener("change", () => { paintActs(); void read(); });
    let typing = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
    q.addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => void read(), 250); });
    more.addEventListener("click", () => void read(true));
    // A marketplace of yours: owner/repo, a git or marketplace.json address, or a folder.
    const addInput = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input", type: "text", placeholder: "owner/repo, a git or marketplace.json address, or a folder", spellcheck: "false" }));
    const addGo = h("button", { class: "sm", type: "button" }, "Add marketplace");
    const addErr = h("p", { class: "spc-missing", hidden: "" });
    addGo.addEventListener("click", async () => {
      const source = addInput.value.trim();
      if (!source) return addInput.focus();
      addGo.setAttribute("disabled", "");
      addErr.hidden = true;
      try {
        const r = await api("/plugins/marketplaces", { method: "POST", body: { source } });
        toast(`${r?.marketplace?.title || "The marketplace"} is added.`);
        addInput.value = "";
        await readSources(String(r?.marketplace?.id || ""));
      } catch (/** @type {any} */ e) {
        addErr.textContent = String(e?.message || e);
        addErr.hidden = false;
      } finally { addGo.removeAttribute("disabled"); }
    });
    browseEl.replaceChildren(
      h("div", { class: "plg-browse-bar" }, pick, q, srcActs),
      list,
      more,
      h("details", { class: "plg-add-market" }, h("summary", {}, "Add a marketplace…"), h("div", { class: "set-list-row" }, addInput, addGo), addErr));
    paintActs();
    void read();
    return pick;
  }

  /** @param {string} [select]  a marketplace to show once read */
  async function readSources(select = "") {
    try {
      sources = await api("/plugins/sources");
      paintFound(sources);
      const pick = paintBrowse(sources);
      if (select && Array.from(pick.options).some((o) => o.value === select)) {
        pick.value = select;
        pick.dispatchEvent(new Event("change"));
      }
    } catch (/** @type {any} */ e) {
      foundEl.replaceChildren(h("p", { class: "spc-missing" }, String(e?.message || e)));
    }
  }

  paintServers(cb.connectors?.start || null, cb.connectors?.finish || null);
  // Opened at its connectors part (Connectors' address, a Space's door): in sight, the page's title kept where it can be.
  if (cb.connectors?.at) connectorsEl.scrollIntoView?.({ block: "nearest" });
  void readSources();
  void readInstalled();
  // Opened at a plugin from a connector's row: its sheet, over the page.
  if (cb.open) open({ id: cb.open });
}
