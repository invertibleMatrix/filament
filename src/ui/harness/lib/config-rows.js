// @ts-check
// Filament's own settings drawn from the schema (HarnessV4_Settings_Plan HS-4, HC-68), for the Filament pages and Memory's
// Engine group: each leaf of a section is a row, in the schema's order under its groups, so a setting a later version
// adds appears by itself. A row is kept at once (HS-D4) through `PATCH /api/config/fields`, which names the one field
// and the version the page read; Reset puts Filament's default back. What a row shows is the configuration as
// `GET /api/state` says it, read again after each write. A credential is never drawn. Built with an injected `h` and
// `api`, so a page runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { keyWords } from "../../lib/format.js";
import { api } from "./api.js";
import { keptArea, keptField, segment, toggle } from "./fields.js";

/** @typedef {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void }} PageCallbacks */
/** @typedef {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any> }} PageIo */
/** @typedef {ReturnType<typeof configKit>} ConfigKit */

/** @param {any} node @returns {boolean} a schema leaf ({ type, description }), not a group */
export function isLeaf(node) {
  return !!node && typeof node === "object" && typeof node.type === "string" && "description" in node;
}

/**
 * A schema group's leaves, flat, with their full dotted paths, in document order (`_doc` skipped).
 * @param {any} group @param {string} [prefix] @returns {[string, any][]}
 */
export function walkGroup(group, prefix = "") {
  /** @type {[string, any][]} */
  const out = [];
  for (const [k, v] of Object.entries(group || {})) {
    if (k === "_doc") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v)) out.push([path, v]);
    else out.push(...walkGroup(v, path));
  }
  return out;
}

/** @param {any} doc @param {string} path */
export function getDotted(doc, path) {
  let cur = doc;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Which control a leaf is (HC-68): a choice among a few short options a segment, among more a menu; a boolean a switch;
 * a number a field; a list of text a box of lines; a list of choices checkboxes; other text a field, or an area where it
 * runs to lines; a list of objects or a map its JSON in an area. A credential is no row ("none").
 * @param {any} leaf
 * @returns {"segment" | "select" | "switch" | "number" | "text" | "area" | "lines" | "checks" | "json" | "none"}
 */
export function leafControlKind(leaf) {
  if (leaf.type === "secret" || leaf.itemType === "secret") return "none";
  const list = leaf.type === "array" || leaf.type === "list";
  const options = Array.isArray(leaf.options) ? leaf.options : [];
  if (list && leaf.itemType === "enum") return "checks";
  if (list && leaf.itemType === "string") return "lines";
  if (options.length) return options.length <= 4 && options.every((o) => String(o).length <= 12) ? "segment" : "select";
  if (leaf.type === "boolean") return "switch";
  if (leaf.type === "number") return "number";
  if (leaf.type === "string") return leaf.multiline ? "area" : "text";
  return "json";
}

/** A value in a few words, for a toast. @param {any} v */
export function valueWords(v) {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (Array.isArray(v)) return !v.length ? "none" : v.every((x) => typeof x === "string") ? v.join(", ").slice(0, 80) : `${v.length} entr${v.length === 1 ? "y" : "ies"}`;
  if (v === "" || v == null) return "empty";
  if (typeof v === "object") return "changed";
  return String(v).slice(0, 80);
}

/** The schema's words as plain text: its `code` marks go. @param {unknown} s */
const plain = (s) => String(s || "").replace(/`/g, "");

/**
 * A page of Filament's settings: the schema and the configuration read, `page.rows(kit)` drawn, and drawn again after
 * each write. An older read that lands after a newer one draws nothing.
 * @param {HTMLElement} body @param {PageCallbacks} cb @param {PageIo} io
 * @param {{ rows: (kit: ConfigKit) => any[] }} page
 * @returns {{ redraw: () => Promise<void> }}
 */
export function mountConfigPage(body, cb, io, page) {
  const m = io.h || h;
  const call = io.api || api;
  const host = m("div", { class: "nset cset" });
  body.replaceChildren(host);
  /** @type {any} */
  let schema = null;
  let seq = 0;
  const draw = async () => {
    const at = ++seq;
    /** @type {any} */
    let state;
    try {
      [schema, state] = await Promise.all([schema || call("/schema"), call("/state")]);
    } catch (/** @type {any} */ e) {
      if (at === seq) host.replaceChildren(m("p", { class: "set-error" }, `Filament's settings could not be read: ${String(e?.body?.error || e?.message || e)}`));
      return;
    }
    if (at === seq) host.replaceChildren(...page.rows(configKit(schema, state, draw, cb, io)));
  };
  void draw();
  return { redraw: draw };
}

/**
 * The rows' parts over the schema and the configuration as read.
 * @param {any} schema  `GET /api/schema` @param {any} state  `GET /api/state` @param {() => Promise<void>} redraw
 * @param {PageCallbacks} cb @param {PageIo} io
 */
export function configKit(schema, state, redraw, cb, io) {
  const m = io.h || h;
  const call = io.api || api;
  const cfg = state?.config || {};
  /** @param {string} path @returns {any} */
  const leaf = (path) => {
    const n = getDotted(schema?.config, path);
    return isLeaf(n) ? n : null;
  };
  /** @param {string} path */
  const value = (path) => getDotted(cfg, path);
  /** @param {string} path */
  const labelOf = (path) => keyWords(path.split(".").pop() || path);

  /**
   * One change, said in a toast; the page is read again either way. `said`: the toast's words from the answer.
   * @param {{ set?: Record<string, any>, unset?: string[] }} change @param {(r: any) => string} said @returns {Promise<boolean>}
   */
  const write = async (change, said) => {
    let ok = false;
    try {
      const r = await call("/config/fields", { method: "PATCH", body: { ...change, base: state?.configVersion } });
      ok = true;
      if (r?.changes?.length) cb.onToast?.(`${said(r)}${r.restartNeeded ? " — Filament listens there after a restart" : ""}`);
    } catch (/** @type {any} */ e) {
      cb.onToast?.(e?.body?.stale ? "Not changed: it was changed elsewhere since this page read it, and shows that now" : `Not changed: ${String(e?.body?.error || e?.message || e)}`, "err");
    }
    if (ok) cb.onChanged?.();
    await redraw();
    return ok;
  };
  /** A field set: the toast names it with its value. @param {string} path @param {any} v */
  const setField = (path, v) => write({ set: { [path]: v } }, (r) => `${labelOf(path)}: ${valueWords(r.values?.[path])}`);

  /** Where a value comes from, and Reset where it is the person's own. @param {string} path */
  const from = (path) => {
    const l = leaf(path);
    const own = !!l && JSON.stringify(value(path) ?? null) !== JSON.stringify(l.default ?? null);
    return m("div", { class: "nset-from" },
      m("span", {}, own ? "Set by you" : "Filament's default"),
      own ? m("button", { class: "nset-reset", type: "button", title: `Back to Filament's default: ${valueWords(l.default)}`, onclick: () => void write({ unset: [path] }, () => `${labelOf(path)}: back to Filament's default (${valueWords(l.default)})`) }, "Reset") : null);
  };

  /**
   * A row: its label, its words and where its value comes from on the left; its control on the right, or under them.
   * A leaf's row carries its path, which Settings search finds it by.
   * @param {string} label @param {string} desc @param {any} control @param {{ path?: string, wide?: boolean, title?: string }} [o]
   */
  const row = (label, desc, control, o = {}) =>
    m("div", { class: `settings-row nset-row${o.wide ? " is-wide" : ""}`, ...(o.path ? { "data-path": o.path } : {}) },
      m("div", { class: "settings-row-text", ...(o.title ? { title: o.title } : {}) },
        m("div", { class: "settings-row-label" }, label),
        desc ? m("div", { class: "settings-row-desc" }, desc) : null,
        o.path ? from(o.path) : null),
      control == null ? null : m("div", { class: o.wide ? "nset-wide" : "shrink-0" }, control));

  /** @param {string} title */
  const head = (title) => m("h3", { class: "nset-h" }, title);
  /** A line of the page's own words. @param {string} text @param {string} [kind]  "warn" */
  const note = (text, kind = "") => m("p", { class: `nset-note${kind ? ` is-${kind}` : ""}` }, text);

  /**
   * The control for one leaf, kept at once.
   * @param {string} path @param {any} l @param {string} label
   */
  const control = (path, l, label) => {
    const v = value(path);
    const kind = leafControlKind(l);
    /** @type {string[]} */
    const options = Array.isArray(l.options) ? l.options.map(String) : [];
    if (kind === "switch") return toggle(m, v === true, label, () => void setField(path, v !== true));
    if (kind === "segment") return segment(m, options.map((o) => ({ value: o, label: o })), String(v ?? ""), (nv) => { if (nv !== v) void setField(path, nv); }, label);
    if (kind === "select")
      return m("select", { class: "set-select", "aria-label": label, onchange: (/** @type {any} */ e) => void setField(path, String(e.target.value)) },
        ...options.map((o) => m("option", { value: o, ...(o === v ? { selected: "" } : {}) }, o)));
    if (kind === "number")
      return keptField(m, v == null ? "" : String(v), async (s) => {
        const n = Number(s);
        if (s === "" || !Number.isFinite(n)) {
          cb.onToast?.(`${label} is a number`, "err");
          return false;
        }
        return setField(path, n);
      }, { class: "zc-input nset-num", inputmode: "decimal", "aria-label": label });
    if (kind === "text") return keptField(m, String(v ?? ""), (s) => setField(path, s), { class: "zc-input nset-text", "aria-label": label });
    if (kind === "area") return keptArea(m, String(v ?? ""), (s) => setField(path, s), { "aria-label": label, rows: String(l.rows || 4), class: "zc-input set-area nset-prose" });
    if (kind === "lines")
      return keptArea(m, (Array.isArray(v) ? v : []).join("\n"), (s) => setField(path, s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)), { "aria-label": label, rows: "3", placeholder: "One on each line" });
    if (kind === "checks") {
      const cur = Array.isArray(v) ? v.map(String) : [];
      return m("div", { class: "nset-checks", role: "group", "aria-label": label },
        ...options.map((o) => {
          const on = cur.includes(o);
          return m("label", { class: "nset-check" },
            m("input", { type: "checkbox", ...(on ? { checked: "" } : {}), onchange: () => void setField(path, options.filter((x) => (x === o ? !on : cur.includes(x)))) }),
            m("span", {}, o));
        }));
    }
    return keptArea(m, JSON.stringify(v ?? l.default ?? null, null, 2), async (s) => {
      let parsed;
      try {
        parsed = JSON.parse(s);
      } catch (/** @type {any} */ e) {
        cb.onToast?.(`${label} is JSON: ${String(e?.message || e)}`, "err");
        return false;
      }
      return setField(path, parsed);
    }, { "aria-label": label, rows: "4", class: "zc-input set-area" });
  };

  /**
   * One leaf's row, or null for a credential or a path the schema does not hold. `label` and `desc` take the place of
   * the schema's words; `control`, the page's own control in place of the one the leaf's kind draws — an element (a few
   * choices in words over a field of text), or one made from the row's label (a list of folders, a model picker: the
   * owner's of 11-09, no list as JSON) —, under the words where `wide`.
   * @param {string} path @param {{ label?: string, desc?: string, control?: any, wide?: boolean }} [o]
   */
  const field = (path, o = {}) => {
    const l = leaf(path);
    const label = o.label || labelOf(path);
    // A credential (a search service's key): whether it is set, never its value — typed in the console's Settings,
    // which seals it; the harness's fields take none (config-fields.js `fieldLeaf`).
    if (l?.type === "secret") {
      const set = typeof value(path) === "string" && value(path) !== "";
      return m("div", { class: "settings-row nset-row", "data-path": path },
        m("div", { class: "settings-row-text", title: plain(l.effect) },
          m("div", { class: "settings-row-label" }, label),
          m("div", { class: "settings-row-desc" }, `${o.desc ?? plain(l.description)} A credential is typed in the Filament console's Settings › Agent loop (Open Filament console), never here.`),
          m("div", { class: "nset-from" }, m("span", {}, set ? "Set · sealed on this computer" : "Not set"))));
    }
    if (!l || leafControlKind(l) === "none") return null;
    const wide = o.wide ?? ["area", "lines", "checks", "json"].includes(leafControlKind(l));
    const own = typeof o.control === "function" ? o.control(label) : o.control;
    return row(label, o.desc ?? plain(l.description), own ?? control(path, l, label), { path, wide, title: plain(l.effect) });
  };

  /**
   * A group's rows in the schema's order, each of its own groups under a heading with its words. `skip`: paths left out;
   * a group all of whose rows are left out draws no heading either.
   * @param {string} path @param {{ skip?: string[], title?: string | null, doc?: string | null }} [o]
   * @returns {any[]}
   */
  const group = (path, o = {}) => {
    const node = getDotted(schema?.config, path);
    if (!node || typeof node !== "object" || isLeaf(node)) return [];
    const skip = new Set(o.skip || []);
    /** @type {any[]} */
    const rows = [];
    /** @type {[string, string][]} */
    const inner = [];
    for (const [k, v] of Object.entries(node)) {
      const p = `${path}.${k}`;
      if (k === "_doc" || skip.has(p)) continue;
      if (isLeaf(v)) rows.push(field(p));
      else inner.push([k, p]);
    }
    for (const [k, p] of inner) rows.push(...group(p, { skip: o.skip, title: keyWords(k), doc: getDotted(schema?.config, p)?._doc || null }));
    const kept = rows.filter(Boolean);
    if (!kept.length) return [];
    return [...(o.title ? [head(o.title)] : []), ...(o.doc ? [note(plain(o.doc))] : []), ...kept];
  };

  return { m, call, cb, io, schema, state, cfg, leaf, value, write, setField, row, head, note, field, group, redraw };
}
