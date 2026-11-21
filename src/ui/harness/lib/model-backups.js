// @ts-check
// A model's backups on its provider's page (HarnessV4_Settings_Plan HS-5; the owner's settings cleanup of 11-09): where
// a model of an API provider goes when its provider fails, and the sheet
// that sets them — the providers in order, each with the model's name there, picked from the names it serves or typed
// (HC-73), kept on Save as the route the server writes for it (core/backups.js). A coding agent's model takes none
// (HS-D59): its card never asks.
// The view is GET /api/model-routes, read at a version; a write names it and the server refuses one read before a
// newer change to the same route (HS-D3). A change heard on the events stream reads the view again. Built with an
// injected `h`, `api`, dialogs and the events stream, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { followConfig } from "../../lib/config-follow.js";
import { api } from "./api.js";
import { onBus } from "./bus.js";
import { ICONS } from "./icons.js";
import { confirmDialog, dialog } from "./ui.js";

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);
/** @param {unknown} s */
const low = (s) => String(s ?? "").toLowerCase();

/** How a route chooses among its providers, in words (the server's STRATEGY_WORDS). */
const STRATEGY = { round_robin: "taking turns", random: "at random", least_latency: "the fastest lately first", least_cost: "the cheapest first", quota_aware: "the one with the most quota left first" };

/** A name compared across providers: its last part, case, date stamp and dots aside. @param {unknown} s */
const key = (s) => low(String(s ?? "").split("/").pop()).replace(/-\d{8}$/, "").replace(/\./g, "-");

/**
 * The name a backup provider serves the model under (HS-D64): the one that is the same model, its path and spelling
 * aside, else none.
 * @param {string[]} names @param {string} sent
 */
export function bestName(names, sent) {
  const want = key(sent);
  return names.find((n) => n === sent) || names.find((n) => key(n) === want) || "";
}

/**
 * A row's backups in words: "Then OpenRouter as z-ai/glm-5.3", "No backups", or where they are set when not here.
 * @param {any} row  a model of the view
 */
export function chainWords(row) {
  if (row.upstream.agent) return "";
  const list = row.backups.map((/** @type {any} */ b) => `${b.name} as ${b.sent}${b.agent ? " (a coding agent)" : !b.enabled ? " (off: skipped)" : ""}`);
  const how = list.length > 1 && row.strategy !== "in_order" ? `, chosen ${STRATEGY[/** @type {keyof typeof STRATEGY} */ (row.strategy)] || row.strategy}` : "";
  const said = list.length ? `Then ${list.join(", then ")}${how}` : "No backups";
  return row.can ? said : `${said} · ${row.why}`;
}

/**
 * What the sheet's list does, in one sentence.
 * @param {any} row @param {{ upstream: string, upstreamModel: string }[]} rows @param {(id: string) => string} nameOf
 */
export function sheetSentence(row, rows, nameOf) {
  const first = `${row.lead} goes to ${row.upstream.name} as ${row.sent}`;
  const then = rows.filter((x) => x.upstreamModel.trim()).map((x) => `${nameOf(x.upstream)} as ${x.upstreamModel.trim()}`);
  return then.length ? `${first}; when it fails, ${then.join(", then ")}.` : `${first}, and nowhere else when it fails.`;
}

/** What the sheet says while backups are off for every model (the owner's of 11-09: off unless switched on). */
export const OFF_NOTE = "Backups are off for every model: switch on Use backups when a provider fails, at the top of Settings › Providers.";

/** A button in the harness's own markup (lib/ui.js `button`), built with the injected `h`. */
const btn = (/** @type {typeof h} */ m, /** @type {string} */ label, /** @type {string} */ variant, /** @type {() => void} */ onClick, /** @type {Record<string, any>} */ extra = {}) =>
  m("button", { class: `zc-btn zc-btn-v-${variant} zc-btn-s-sm${extra.class ? ` ${extra.class}` : ""}`, type: "button", onclick: onClick, ...(extra.title ? { title: extra.title } : {}), ...(extra.label ? { "aria-label": extra.label } : {}), ...(extra.disabled ? { disabled: "" } : {}) },
    extra.html ? m("span", { class: "zc-btn-ic", html: extra.html }) : null, label ? m("span", { class: "zc-btn-label" }, label) : null);

/**
 * Every model's backups, as the provider pages' rows read them: `ready` the first read, `rowOf` a family's model of
 * the view (null before it is read, or for a family no route takes), `open` its sheet, `listen` a change of the view.
 * @param {{ onToast?: (msg: string, kind?: string) => void, alive?: () => boolean }} [o]  `alive`: whether the page
 *   that holds it is still drawn — once it is not, the events stream is let go
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, dialog?: typeof dialog, confirm?: typeof confirmDialog,
 *   subscribe?: (fn: (msg: any) => void) => () => void }} [io]
 */
export function modelBackups(o = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openDialog = io.dialog || dialog;
  const ask = io.confirm || confirmDialog;
  const subscribe = io.subscribe || onBus;
  const toast = o.onToast || (() => {});
  /** @type {any} */
  let view = null;
  /** The view's models by `upstream\0family` and `upstream\0lead`. @type {Map<string, any>} */
  let byKey = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();

  const take = (/** @type {any} */ v) => {
    view = v;
    byKey = new Map();
    for (const r of v?.models || []) {
      byKey.set(`${r.upstream.id}\0${r.id}`, r);
      if (!byKey.has(`${r.upstream.id}\0${r.lead}`)) byKey.set(`${r.upstream.id}\0${r.lead}`, r);
    }
    for (const fn of [...listeners]) fn();
    return Number(v?.version) || 0;
  };
  const follow = followConfig({
    dirty: () => false,
    reload: async () => take(await call("/model-routes")),
    changes: async () => ({ count: null, changes: null }),
    bar: () => {},
  });
  async function read() {
    try {
      follow.loaded(take(await call("/model-routes")));
    } catch {
      // Unread, a row offers no Backups ›: the next change heard reads it again.
    }
  }
  const off = subscribe((msg) => {
    if (o.alive && !o.alive()) return off();
    if (msg?.type === "config-changed") follow.heard(msg.version);
    else if (msg?.type === "hello" || msg?.type === "models-discovered") void read();
  });

  /** A provider's name as the view has it. @param {string} id */
  const nameOf = (id) => view?.providers.find((/** @type {any} */ p) => p.id === id)?.name || view?.models.find((/** @type {any} */ r) => r.upstream.id === id)?.upstream.name || id;

  /** The backups sheet (HC-96): kept on Save, dropped on Cancel; Cancel with edits asks first. @param {any} row */
  function sheet(row) {
    const rows = row.backups.map((/** @type {any} */ b) => ({ upstream: b.id, upstreamModel: b.sent }));
    const was = JSON.stringify(rows);
    const label = row.label || row.id;
    const list = m("div", { class: "mdl-brows" });
    const sentence = m("p", { class: "mdl-sentence" });
    const said = m("p", { class: "prov-err", role: "alert" });
    const providers = () => view.providers;
    let saving = false;
    let n = 0;
    /** @param {number} i @param {number} by */
    const move = (i, by) => {
      const j = i + by;
      if (j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      draw();
    };
    function draw() {
      list.replaceChildren(...(rows.length ? rows.map((x, i) => {
        const p = providers().find((/** @type {any} */ q) => q.id === x.upstream);
        const id = `mdl-names-${++n}`;
        const pick = /** @type {any} */ (m("select", { class: "zc-input mdl-bpick", "aria-label": `Backup ${i + 1}: its provider` },
          ...providers().map((/** @type {any} */ q) => m("option", { value: q.id, ...(q.id === x.upstream ? { selected: "" } : {}) }, `${q.name}${q.enabled ? "" : " (off)"}`))));
        pick.value = x.upstream;
        pick.onchange = () => {
          x.upstream = String(pick.value);
          x.upstreamModel = bestName(providers().find((/** @type {any} */ q) => q.id === x.upstream)?.names || [], row.sent);
          draw();
        };
        const name = /** @type {any} */ (m("input", { class: "zc-input mdl-bname", type: "text", list: id, value: x.upstreamModel, placeholder: "The model's name there", "aria-label": `Backup ${i + 1}: the model's name there`, spellcheck: "false", autocomplete: "off" }));
        name.oninput = () => {
          x.upstreamModel = String(name.value);
          note.replaceChildren(noteOf());
          sentence.replaceChildren(sheetSentence(row, rows, nameOf));
        };
        const noteOf = () => {
          const typed = x.upstreamModel.trim();
          const out = [];
          if (p && !p.enabled) out.push(`${p.name} is switched off: it is skipped until it is on again.`);
          if (typed && p && !p.names.includes(typed)) out.push(`Not in ${p.name}'s list: a request there says whether it answers.`);
          if (!typed) out.push(`Pick or type its name at ${p?.name || "that provider"}.`);
          return out.join(" ");
        };
        const note = m("span", { class: "mdl-bnote" }, noteOf());
        return m("div", { class: "mdl-brow", "data-backup": String(i + 1) },
          m("span", { class: "mdl-bn", "aria-hidden": "true" }, String(i + 1)),
          pick,
          name,
          m("datalist", { id }, ...(p?.names || []).map((/** @type {string} */ v) => m("option", { value: v }))),
          m("span", { class: "mdl-bacts" },
            btn(m, "", "ghost", () => move(i, -1), { html: ICONS.arrowUp, label: `Move backup ${i + 1} up`, title: "Tried earlier", disabled: i === 0 }),
            btn(m, "", "ghost", () => move(i, 1), { html: ICONS.arrowDown, label: `Move backup ${i + 1} down`, title: "Tried later", disabled: i === rows.length - 1 }),
            btn(m, "", "ghost", () => { rows.splice(i, 1); draw(); }, { html: ICONS.x, label: `Take backup ${i + 1} off` })),
          m("span", { class: "mdl-bnote-row" }, note));
      }) : [m("p", { class: "prov-quiet" }, `No backups: when ${row.upstream.name} fails, ${label} fails.`)]));
      sentence.replaceChildren(sheetSentence(row, rows, nameOf));
    }
    // The next backup offered (HS-D67): a provider not yet in the list that serves the same model, else the next one
    // switched on, else any.
    const add = () => {
      const free = providers().filter((/** @type {any} */ q) => q.id !== row.upstream.id && !rows.some((x) => x.upstream === q.id));
      const p = free.find((/** @type {any} */ q) => q.enabled && bestName(q.names, row.sent)) || free.find((/** @type {any} */ q) => q.enabled) || providers().find((/** @type {any} */ q) => q.enabled) || providers()[0];
      if (!p) return toast("No provider can be a backup: add another under Providers", "err");
      rows.push({ upstream: p.id, upstreamModel: bestName(p.names, row.sent) });
      draw();
    };
    const notes = [
      !row.route?.exact && (row.format !== "auto" || row.ruleOverrides) ? `Route ${row.route?.match} sends it in ${row.format === "anthropic" ? "Anthropic's" : row.format === "openai" ? "OpenAI's" : "its own"} format${row.ruleOverrides ? ` with ${row.ruleOverrides} rule override${row.ruleOverrides === 1 ? "" : "s"}` : ""}: its backups' route keeps the same.` : null,
      row.alone.length ? `These cover ${row.lead} and the settings Filament applies to it. Its other ids go to ${row.upstream.name} alone: ${row.alone.slice(0, 4).join(", ")}${row.alone.length > 4 ? ` and ${row.alone.length - 4} more` : ""}.` : null,
      view.failover ? null : OFF_NOTE,
    ].filter(Boolean).map((t) => m("p", { class: "prov-note" }, t));
    const save = async () => {
      if (saving) return;
      saving = true;
      said.replaceChildren();
      try {
        await follow.own(async () => {
          const v = await call("/model-routes", { method: "PUT", body: { name: row.lead, backups: rows.map((x) => ({ upstream: x.upstream, upstreamModel: x.upstreamModel.trim() })), base: follow.base() } });
          follow.loaded(take(v));
        });
        d.close(true);
        const then = rows.map((x) => nameOf(x.upstream));
        toast(rows.length ? `Backups for ${label} kept: when ${row.upstream.name} fails, ${then.join(", then ")} answer${then.length === 1 ? "s" : ""}, from the next message` : `${label} has no backups now: it goes to ${row.upstream.name} alone`);
      } catch (e) {
        const b = /** @type {any} */ (e)?.body;
        if (b?.stale) {
          d.close(true);
          toast(`${label}'s backups changed elsewhere since this page read them${b.changes?.length ? `: ${b.changes[0]}` : ""}. They now show as they are: make your change again if you still want it.`, "err");
          await read();
        } else said.replaceChildren(errText(e));
      } finally {
        saving = false;
      }
    };
    let asking = false;
    const box = m("div", { class: "mdl-sheet" },
      list,
      m("div", { class: "prov-acts" }, btn(m, "Add a backup", "outline", add, { html: ICONS.plus })),
      sentence,
      ...notes,
      said,
      m("div", { class: "prov-add-foot" }, btn(m, "Cancel", "outline", () => d.close()), btn(m, "Save", "default", () => void save())));
    const d = openDialog({
      title: `Backups for ${label}`,
      description: `${row.lead} goes to ${row.upstream.name} first. When it fails, each backup is tried in turn, under its own name for the model.`,
      body: box,
      wide: true,
      guard: () => {
        if (JSON.stringify(rows) === was) return true;
        if (!asking) {
          asking = true;
          void ask({ title: "Discard these backups?", description: "Nothing changes until you press Save.", confirmLabel: "Discard", destructive: true }).then((yes) => {
            asking = false;
            if (yes) d.close(true);
          });
        }
        return false;
      },
    });
    draw();
  }

  const ready = read();
  return {
    ready,
    /** A family's model of the view, by its provider and the family's id or lead. @param {string} upstream @param {{ id: string, lead?: string }} f */
    rowOf: (upstream, f) => byKey.get(`${upstream}\0${f.id}`) || (f.lead ? byKey.get(`${upstream}\0${f.lead}`) : null) || null,
    /** @param {any} row */
    open: (row) => sheet(row),
    /** @param {() => void} fn */
    listen(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}
