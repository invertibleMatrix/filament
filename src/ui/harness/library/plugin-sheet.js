// @ts-check
// The plugin sheet (HarnessV4_SpacesPlugins_Plan B5, the Designer's §6 E), top to bottom: its name, version and where it
// comes from; what it adds — each part, what it becomes here and what runs —; what is not supported here, folded; the
// values it asks for at the place, a secret masked and never shown again; what it weighs in every request where it is
// on; and where to turn it on — All chats, a Space of yours, a project. Add… opens it and installs nothing: the button
// says exactly what happens ("Install for Work, with 1 hook"). An installed plugin opens the same sheet: where it is on,
// its values per place, an update that waits for you with what it changes, Check for updates, Uninstall….
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { confirmDialog, sheet } from "../lib/ui.js";
import { pickPlace, placeChoices } from "../space/pick-place.js";
import { state } from "../state.js";
import { agentsPage } from "../../lib/teams-on.js";

/** A hook's moment, in the sheet's words: when it runs, without asking anyone. @param {{ event: string, matcher: string }} x */
export function hookWhen(x) {
  const tool = x.matcher && x.matcher !== "*" ? `${x.matcher} call` : "tool call";
  return x.event === "PreToolUse" ? `before each ${tool}` : x.event === "PostToolUse" ? `after each ${tool}` : x.event === "Stop" ? "when a turn ends" : x.event === "SessionStart" ? "when a chat starts" : "";
}

/** The hooks Filament runs (B6): Claude's four moments, command hooks first. @param {any[]} hooks */
export const runnableHooks = (hooks) => (hooks || []).filter((x) => x.type === "command" && hookWhen(x));

/**
 * Whether a plugin turned on at a place goes on to its setup there (the Designer's of 10-26): it brings a server over
 * the web — a sign-in may wait, which nothing said for Linear and Figma on Northwind — and the place has a Connectors
 * list (a chat's own has no page of its own).
 * @param {any} v  the preview or the installed plugin @param {string} at  the place
 */
export const setsUpAt = (v, at) => !String(at).startsWith("chat:") && (v?.parts?.servers || []).some((/** @type {any} */ x) => x.remote);

/** A name's plural, plainly. @param {number} n @param {string} one @param {string} [many] */
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Words with their first letter capitalized, for a line's head. @param {string} s */
const upFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * What the plugin adds, part by part: what each becomes here and what runs (the Designer's §6 E 2).
 * @param {any} v  the preview or the installed plugin
 * @param {{ hooksBox?: HTMLInputElement | null }} [o]
 */
export function partsList(v, { hooksBox = null } = {}) {
  const p = v.parts || {};
  const name = String(v.name || "");
  const li = (/** @type {any[]} */ ...kids) => h("li", { class: "plg-part" }, ...kids);
  const code = (/** @type {string} */ t) => h("code", { class: "plg-code" }, t);
  const rows = [];
  for (const s of p.servers || [])
    rows.push(li(h("b", {}, s.as || s.name), " → connector, on demand; ", ...(s.remote ? ["reached at ", code(s.runs)] : ["starts ", code(s.runs), " when a chat with it opens"])));
  for (const s of p.lsp || [])
    rows.push(li(h("b", {}, s.as || s.name), ` → language server for ${(s.files || []).join(", ")} files; starts `, code(s.runs), " when an agent first asks of one, where it is installed"));
  const skillNames = (p.skills || []).map((/** @type {string} */ s) => `${name}:${s.split("/").pop()}`);
  if (skillNames.length) rows.push(li(h("b", {}, count(skillNames.length, "skill")), " → skills the agent loads when a request matches: ", skillNames.join(", ")));
  const commands = (p.commands || []).map((/** @type {string} */ c) => `/${name}:${(c.split("/").pop() || c).replace(/\.md$/i, "")}`);
  if (commands.length) rows.push(li(h("b", {}, count(commands.length, "command")), " → skills you can type: ", commands.join(", ")));
  if ((p.agents || []).length) rows.push(li(h("b", {}, count(p.agents.length, "agent")), ` → saved agents, tagged ${name}:<name>, in ${agentsPage(state.config)}`));
  const hooks = runnableHooks(p.hooks);
  for (const x of hooks) rows.push(li(h("b", {}, "A hook"), " runs ", code(x.command), ` ${hookWhen(x)}, without asking`));
  if (hooks.length && hooksBox)
    rows.push(h("li", { class: "plg-part plg-hooks-switch" }, h("label", { class: "plg-check" }, hooksBox, ` Run its ${count(hooks.length, "hook")} — off until you tick it`)));
  if (!rows.length) rows.push(li(h("span", { class: "sp-quiet" }, "Nothing Filament can use: see what is not supported here.")));
  return h("ul", { class: "plg-parts" }, ...rows);
}

/**
 * The fields for the values a plugin asks for: a secret masked, a choice a list, yes or no a box. → the element, what
 * is typed, and whether every required one is filled.
 * @param {any[]} asks @param {Record<string, any>} kept  the place's values, a secret as the placeholder
 */
export function valueFields(asks, kept = {}) {
  /** @type {Map<string, () => any>} */
  const reads = new Map();
  const rows = asks.map((a) => {
    const had = kept[a.key];
    let input;
    if (a.type === "boolean") {
      input = h("input", { type: "checkbox", ...(had ?? a.default ? { checked: "" } : {}) });
      reads.set(a.key, () => /** @type {HTMLInputElement} */ (input).checked);
    } else if (Array.isArray(a.options) && a.options.length) {
      input = h("select", { class: "zc-input" }, h("option", { value: "" }, "—"), ...a.options.map((/** @type {string} */ o) => h("option", { value: o, ...((had ?? a.default) === o ? { selected: "" } : {}) }, o)));
      reads.set(a.key, () => /** @type {HTMLSelectElement} */ (input).value);
    } else {
      input = h("input", { class: "zc-input", type: a.sensitive ? "password" : a.type === "number" ? "number" : "text", spellcheck: "false", autocomplete: "off", placeholder: a.sensitive && had ? "Kept — type to change it" : a.default != null ? String(a.default) : "", value: a.sensitive ? "" : had != null ? String(had) : "" });
      reads.set(a.key, () => {
        const t = /** @type {HTMLInputElement} */ (input).value.trim();
        if (!t) return a.sensitive && had ? "__SECRET__" : undefined;
        return a.type === "number" ? Number(t) : t;
      });
    }
    return h("label", { class: "plg-value", "data-key": a.key },
      h("span", { class: "plg-value-name" }, a.title || a.key, a.required ? h("span", { class: "plg-req", title: "Needed" }, " *") : null),
      input,
      a.description ? h("span", { class: "sp-quiet plg-value-desc" }, a.description) : null);
  });
  const read = () => Object.fromEntries([...reads].map(([k, f]) => [k, f()]).filter(([, v]) => v !== undefined && v !== ""));
  const missing = () => {
    const got = read();
    return asks.filter((a) => a.required && a.default == null && (got[a.key] === undefined || got[a.key] === "")).map((a) => a.title || a.key);
  };
  return { el: h("div", { class: "plg-values" }, ...rows), read, missing, inputs: () => rows.map((r) => r.querySelector("input, select")).filter(Boolean) };
}

/**
 * Install for…'s steps, press after press: installed once, then its values kept at the place and it turned on there.
 * A press after a later step failed — a value refused, the turn on — goes on from that step: the plugin is installed
 * already, and installing it again is refused as installed (409). → the plugin's id.
 * @param {{ from: string, name: string, id?: string }} v  the preview
 * @param {(path: string, o?: any) => Promise<any>} [call]  the admin API (a test's stand-in)
 * @returns {(at: string, read: () => { values: Record<string, any>, hooks: boolean }) => Promise<string>}  `read`: the
 *   values and the hooks' box as the sheet holds them, read once it is installed
 */
export function installSteps(v, call = api) {
  let pid = "";
  return async (at, read) => {
    if (!pid) pid = String((await call("/plugins/install", { method: "POST", body: { from: v.from, name: v.name } }))?.plugin?.id || v.id);
    const { values, hooks } = read();
    if (Object.keys(values).length) await call(`/plugins/installed/${encodeURIComponent(pid)}/values`, { method: "POST", body: { place: at, values } });
    await call(`/plugins/installed/${encodeURIComponent(pid)}/on`, { method: "POST", body: { place: at, on: true, hooks } });
    return pid;
  };
}

/**
 * The sheet, open. Add… passes `from` and `name`; an installed plugin its `id`. `place`: where it was opened from —
 * `project:<id>` or `all` —, preselected; from the Library none is. `onSetUp`: a plugin that brings a server over the
 * web, installed or turned on at a place, goes on to its setup there — a sign-in, a test — instead of the sheet just
 * closing (the Designer's of 10-26: Linear and Figma were on for Northwind and nothing said a sign-in waited).
 * @param {{ from?: string, name?: string, id?: string, place?: string, onDone?: () => void, onToast?: (msg: string, kind?: string) => void,
 *   onSetUp?: (place: string, plugin: string, title: string) => void }} o
 */
export function pluginSheet({ from = "", name = "", id = "", place = "", onDone, onToast = () => {}, onSetUp }) {
  /** Its setup at the place, where it has one (`setsUpAt`): true where it went on to it. @param {any} v @param {string} at @param {string} pid */
  const setUp = (v, at, pid) => {
    if (!onSetUp || !setsUpAt(v, at)) return false;
    s.close();
    onSetUp(at, pid, String(v.title || v.name || pid));
    return true;
  };
  const err = h("p", { class: "spc-missing plg-err", hidden: "", role: "alert" });
  /** A refusal, on the sheet. @param {string} m */
  const say = (m) => { err.textContent = m; err.hidden = !m; };
  const body = h("div", { class: "sdb-keep-body plg-body" }, h("p", { class: "sp-quiet" }, from ? "Reading what it holds…" : "Loading…"));
  const title = h("b", { class: "sp-sheet-title" }, name || id || "Plugin");
  const foot = h("div", { class: "sdb-keep-foot plg-foot" });
  const s = sheet({ label: "Plugin", class: "sdb-keep-sheet plg-sheet", head: title, body, foot });

  /** The places it can be turned on at: all chats, your Spaces, then a project…, as Filament lists them. */
  let projects = /** @type {{ id: string, name: string, cwd: string }[]} */ ([]);
  /** The Spaces of your own, each with how many projects it shows, which get what it turns on. */
  let own = /** @type {{ project: string, name: string, shows: number }[]} */ ([]);
  /** @param {string} at */
  const placeLabel = (at) => {
    if (!at) return "";
    if (at === "all") return "all chats";
    const pid = at.replace(/^project:/, "");
    return own.find((o) => o.project === pid)?.name || projects.find((p) => p.id === pid)?.name || pid;
  };

  /**
   * Where to turn it on, as radio rows: All chats, each Space of yours, A project… (a picker); none ticked where the
   * sheet was opened from the Library. → the element and the place chosen.
   * @param {(at: string) => void} onPick
   */
  function placeRows(onPick) {
    let at = place;
    const picked = h("span", { class: "plg-picked" });
    const rows = h("div", { class: "nsp-reaches plg-places", role: "radiogroup", "aria-label": "Turn on for" });
    // The radios follow `at`: a picker closed with no project leaves A project… unticked.
    const paint = () => {
      const projectAt = at.startsWith("project:") && !own.some((o) => `project:${o.project}` === at);
      for (const r of rows.querySelectorAll(".nsp-reach")) {
        const on = r.getAttribute("data-at") === at || (r.getAttribute("data-at") === "pick" && projectAt);
        r.classList.toggle("on", on);
        const radio = r.querySelector("input");
        if (radio) radio.checked = on;
      }
      picked.textContent = projectAt ? placeLabel(at) : "";
    };
    const row = (/** @type {string} */ key, /** @type {string} */ label, /** @type {string} */ words, /** @type {() => void} */ pick) => {
      const radio = h("input", { type: "radio", name: "plg-place", value: key, ...(at === key ? { checked: "" } : {}) });
      // A project… asks on every press, a project picked already too: a ticked radio sends no change.
      radio.addEventListener(key === "pick" ? "click" : "change", pick);
      return h("label", { class: "nsp-reach", "data-at": key }, radio, h("span", { class: "nsp-reach-words" }, h("b", {}, label, key === "pick" ? picked : null), h("span", { class: "sp-quiet" }, words)));
    };
    rows.append(
      row("all", "All chats", "Every chat, in every project and Space, unless one turns it off.", () => { at = "all"; paint(); onPick(at); }),
      ...own.map((o) => row(`project:${o.project}`, o.name, o.shows ? `Every chat in this Space and in the ${o.shows === 1 ? "project" : `${o.shows} projects`} it shows.` : "Every chat in this Space.", () => { at = `project:${o.project}`; paint(); onPick(at); })),
      row("pick", "A project…", "Every chat in the project you pick.", async () => {
        const choice = await pickPlace({ here: "", choices: placeChoices("", projects, own).filter((c) => !c.own), what: `Turn ${title.textContent} on for every chat in a project.`, title: "Which project?", note: "Its chats get it from their next message. Turn it off there any time." });
        if (choice) at = `project:${choice.id}`;
        paint();
        onPick(at);
      }));
    queueMicrotask(paint);
    return { el: rows, at: () => at };
  }

  /** @param {any} v */
  const head = (v) => {
    title.replaceChildren(v.title || v.name, ...(v.version ? [h("span", { class: "sp-quiet plg-version" }, ` ${v.version}`)] : []));
    return h("p", { class: "sdb-keep-lead plg-lead" }, v.description || "", v.description ? h("br") : null, h("span", { class: "sp-quiet" }, `From ${v.origin || v.market || v.from}`));
  };
  /** What it holds that Filament cannot use, folded; none where it holds none. @param {string[]} lines @returns {HTMLElement[]} */
  const notHere = (lines) => (lines?.length
    ? [h("details", { class: "plg-nothere" }, h("summary", {}, `Not supported here (${lines.length})`), h("ul", {}, ...lines.map((l) => h("li", {}, l))))]
    : []);

  /** Add…: what it holds, read before anything is kept. @param {any} v */
  function paintAdd(v) {
    const hooks = runnableHooks(v.parts.hooks);
    const hooksBox = hooks.length ? /** @type {HTMLInputElement} */ (h("input", { type: "checkbox" })) : null;
    const asks = v.parts.asks || [];
    const values = valueFields(asks);
    const valuesHead = h("h4", { class: "sdb-keep-h" }, "Values");
    const valuesBox = h("div", {}, values.el, h("p", { class: "sp-quiet plg-kept" }, "Kept on this computer, a secret sealed; agents never see them."));
    const go = h("button", { class: "sm primary plg-go", type: "button" });
    const places = placeRows(() => paintGo());
    // Installed, a plugin is on somewhere: Install waits for a place, as Turn on for… does on an installed one — a
    // plugin installed on nowhere gives no chat anything, and its bare Install read as if it did.
    const paintGo = () => {
      const at = places.at();
      const n = hooksBox?.checked ? hooks.length : 0;
      valuesHead.textContent = at ? `Values for ${placeLabel(at)}` : "Values";
      const missing = values.missing();
      go.textContent = at ? `Install for ${placeLabel(at)}${n ? `, with ${count(n, "hook")}` : ""}` : "Install for…";
      go.toggleAttribute("disabled", !!v.installed || !at || missing.length > 0);
      go.title = !at ? "Pick where to turn it on" : missing.length ? `It needs ${missing.join(", ")} first` : "";
    };
    hooksBox?.addEventListener("change", paintGo);
    valuesBox.addEventListener("input", paintGo);
    valuesBox.addEventListener("change", paintGo);
    body.replaceChildren(
      head(v),
      h("h4", { class: "sdb-keep-h" }, "What it adds"),
      partsList(v, { hooksBox }),
      ...notHere(v.parts.notHere),
      ...(asks.length ? [valuesHead, valuesBox] : []),
      h("h4", { class: "sdb-keep-h" }, "Weight"),
      h("p", { class: "plg-weight" }, `Every request where it is on: about ${Number(v.weight || 0).toLocaleString("en-US")} tokens; each part loads in full only when it is used.`),
      h("h4", { class: "sdb-keep-h" }, "Turn on for"),
      places.el,
      err);
    foot.replaceChildren(
      h("span", { class: "sp-quiet" }, v.installed ? "It is installed already: open it from Library › Plugins & Connectors." : "Nothing runs until a chat it is on for needs it."),
      h("span", { class: "sb-sp" }),
      h("button", { class: "ghost sm", type: "button", onclick: () => s.close() }, "Cancel"),
      go);
    paintGo();
    const install = installSteps(v);
    go.addEventListener("click", async () => {
      const at = places.at();
      if (go.hasAttribute("disabled") || !at) return;
      go.setAttribute("disabled", "");
      say("");
      try {
        const pid = await install(at, () => ({ values: values.read(), hooks: !!hooksBox?.checked }));
        onToast(`${v.title || v.name} is installed and on for ${placeLabel(at)}.`);
        onDone?.();
        if (!setUp(v, at, pid)) s.close();
      } catch (/** @type {any} */ e) {
        say(String(e?.message || e));
        go.removeAttribute("disabled");
      }
    });
  }

  /** An installed plugin: where it is on, its values per place, an update that waits, Check, Uninstall…. @param {any} v */
  function paintInstalled(v) {
    const hooks = runnableHooks(v.parts.hooks);
    const asks = v.parts.asks || [];
    const on = /** @type {any[]} */ (v.on || []);
    const where = on.length
      ? h("ul", { class: "plg-where" }, ...on.map((w) => h("li", { class: "plg-where-row" },
          // A row's head: its place's words, capitalized ("All chats", "This chat").
          h("b", {}, upFirst(placeLabel(w.place) || w.label)), " ",
          h("span", { class: "sp-quiet" }, w.on ? (hooks.length ? (w.hooks ? "on, its hooks run" : "on, its hooks off") : "on") : "off here"),
          h("span", { class: "sb-sp" }),
          ...(hooks.length && w.on ? [h("button", { class: "ghost sm", type: "button", onclick: () => turn(w.place, true, !w.hooks) }, w.hooks ? "Stop its hooks" : "Run its hooks")] : []),
          h("button", { class: "ghost sm", type: "button", onclick: () => turn(w.place, !w.on, false) }, w.on ? "Turn off" : "Turn on"))))
      : h("p", { class: "sp-quiet" }, "On nowhere yet: it brings nothing to any chat.");
    const valuesHead = h("h4", { class: "sdb-keep-h" }, "Values");
    const valuesHost = h("div", {});
    let values = valueFields(asks);
    const save = h("button", { class: "sm", type: "button" }, "Save values");
    const turnOn = h("button", { class: "sm primary", type: "button" });
    const places = placeRows((at) => { void readValues(at); paintTurn(); });
    const paintTurn = () => {
      const at = places.at();
      turnOn.textContent = at ? `Turn on for ${placeLabel(at)}` : "Turn on for…";
      turnOn.toggleAttribute("disabled", !at || on.some((w) => w.place === at && w.on));
      valuesHead.textContent = `Values for ${placeLabel(at || "all")}`;
    };
    /** @param {string} at */
    async function readValues(at) {
      if (!asks.length) return;
      try {
        const r = await api(`/plugins/installed/${encodeURIComponent(v.id)}/values?place=${encodeURIComponent(at || "all")}`);
        values = valueFields(asks, r?.values || {});
        valuesHost.replaceChildren(values.el, h("p", { class: "sp-quiet plg-kept" }, "Kept on this computer, a secret sealed; agents never see them. The narrowest place wins: a chat, its project, its Space, all chats."),h("div", { class: "plg-row-acts" }, save));
      } catch (/** @type {any} */ e) { say(String(e?.message || e)); }
    }
    /** @param {string} at @param {boolean} yes @param {boolean} withHooks */
    async function turn(at, yes, withHooks) {
      say("");
      // Newly on there — not its hooks switched where it is on already —: its setup there follows.
      const was = on.some((w) => w.place === at && w.on);
      try {
        await api(`/plugins/installed/${encodeURIComponent(v.id)}/on`, { method: "POST", body: { place: at, on: yes, hooks: withHooks } });
        onToast(yes ? `${v.title} is on for ${placeLabel(at)}.` : `${v.title} is off for ${placeLabel(at)}.`);
        if (yes && !was && setUp(v, at, v.id)) return void onDone?.();
        await reload();
      } catch (/** @type {any} */ e) { say(String(e?.message || e)); }
    }
    save.addEventListener("click", async () => {
      say("");
      try {
        await api(`/plugins/installed/${encodeURIComponent(v.id)}/values`, { method: "POST", body: { place: places.at() || "all", values: values.read() } });
        onToast("Saved. Its chats use them from their next message.");
      } catch (/** @type {any} */ e) { say(String(e?.message || e)); }
    });
    turnOn.addEventListener("click", () => {
      const at = places.at();
      const missing = values.missing();
      if (missing.length) return say(`It needs ${missing.join(", ")} first: fill ${missing.length === 1 ? "it" : "them"} in, then Save values.`);
      if (at) void turn(at, true, false);
    });
    const pending = v.pending
      ? h("div", { class: "plg-pending", role: "status" },
          h("b", {}, `${v.title} changed: ${v.pending.words}.`), " ",
          h("span", { class: "sp-quiet" }, `Version ${v.pending.version || v.pending.sha} waits for you; the one in use stays until you press Update.`),
          h("div", { class: "plg-row-acts" }, h("button", { class: "sm primary", type: "button", onclick: async () => {
            try {
              await api(`/plugins/installed/${encodeURIComponent(v.id)}/update`, { method: "POST", body: {} });
              onToast(`${v.title} is updated.`);
              await reload();
            } catch (/** @type {any} */ e) { say(String(e?.message || e)); }
          } }, "Update")))
      : null;
    body.replaceChildren(
      head(v),
      ...(pending ? [pending] : []),
      h("h4", { class: "sdb-keep-h" }, "What it adds"),
      partsList(v),
      ...notHere(v.parts.notHere),
      h("h4", { class: "sdb-keep-h" }, "Where it is on"),
      where,
      h("h4", { class: "sdb-keep-h" }, "Turn on for"),
      places.el,
      ...(asks.length ? [valuesHead, valuesHost] : []),
      err);
    const check = h("button", { class: "ghost sm", type: "button" }, "Check for updates");
    check.addEventListener("click", async () => {
      check.setAttribute("disabled", "");
      say("");
      try {
        const r = await api(`/plugins/installed/${encodeURIComponent(v.id)}/check`, { method: "POST", body: {} });
        onToast(!r.newer ? `${v.title} is up to date.` : r.applied ? `${v.title} is updated: only its words changed.` : `${v.title} has a newer version that changes what runs: it waits for your Update.`);
        await reload();
      } catch (/** @type {any} */ e) { say(String(e?.message || e)); check.removeAttribute("disabled"); }
    });
    const remove = h("button", { class: "ghost sm danger", type: "button" }, "Uninstall…");
    remove.addEventListener("click", async () => {
      const yes = await confirmDialog({ title: `Uninstall ${v.title}?`, description: `Its copy and the values kept for it go, and it is turned off everywhere. Its data folder stays unless you remove it too: ${v.data}`, confirmLabel: "Uninstall", destructive: true });
      if (!yes) return;
      const data = await confirmDialog({ title: `Remove ${v.title}'s data folder too?`, description: `What it saved while it ran: ${v.data}. Cancel keeps it, if you may install it again.`, confirmLabel: "Remove it", destructive: true });
      try {
        await api(`/plugins/installed/${encodeURIComponent(v.id)}${data ? "?data=1" : ""}`, { method: "DELETE" });
        onToast(`${v.title} is uninstalled.`);
        s.close();
        onDone?.();
      } catch (/** @type {any} */ e) { say(String(e?.message || e)); }
    });
    foot.replaceChildren(check, remove, h("span", { class: "sb-sp" }), h("button", { class: "ghost sm", type: "button", onclick: () => s.close() }, "Close"), turnOn);
    paintTurn();
    void readValues(places.at());
  }

  let shownId = id;
  async function reload() {
    try {
      const v = await api(`/plugins/installed/${encodeURIComponent(shownId)}`);
      paintInstalled(v);
      onDone?.();
    } catch (/** @type {any} */ e) { say(String(e?.message || e)); }
  }

  Promise.all([api("/memory/projects").catch(() => null), api("/spaces/own").catch(() => null)]).then(async ([p, o]) => {
    projects = (p?.projects || []).filter((/** @type {any} */ x) => !x.archived).map((/** @type {any} */ x) => ({ id: String(x.id), name: String(x.name || x.cwd || x.id), cwd: String(x.cwd || "") }));
    own = (o?.spaces || []).map((/** @type {any} */ x) => ({ project: String(x.project), name: String(x.name), shows: (x.shows || []).filter((/** @type {any} */ s) => projects.some((p) => p.id === s)).length }));
    try {
      if (id) return paintInstalled(await api(`/plugins/installed/${encodeURIComponent(id)}`));
      const v = await api("/plugins/preview", { method: "POST", body: { from, name } });
      if (v.installed) {
        shownId = v.id;
        return paintInstalled(await api(`/plugins/installed/${encodeURIComponent(v.id)}`));
      }
      paintAdd(v);
    } catch (/** @type {any} */ e) {
      body.replaceChildren(err);
      say(String(e?.message || e));
      foot.replaceChildren(h("span", { class: "sb-sp" }), h("button", { class: "ghost sm", type: "button", onclick: () => s.close() }, "Close"));
    }
  });
  return s;
}
