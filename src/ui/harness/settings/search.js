// @ts-check
// Settings › search (HarnessV4_Settings_Plan HS-6, HS-D68, HS-D69): one field over the sidebar finds a setting by its
// words. What it searches: each section's name and description; the rows each page draws — a hand-drawn page's from
// the list beside its code (`SEARCH_ROWS`, which test/settings-search.test.js checks against that code), a
// schema-drawn page's run over the schema as the page runs them, so a setting a later version adds is found by itself
// — the keyboard shortcuts; and Filament's own reads of your things: providers and each one's key, models with their
// provider, MCP servers with the names their environment and headers hold, coding agents, your agents and teams. The
// reads are made when the field is first used on a drawn page; a value is never sent anywhere.
// While the field has words the results take the sections' place: ↓ ↑ mark one, Enter opens the one marked, Esc
// empties the field. Opening a result opens its section (a provider's row, its page), scrolls to the row and lights
// it for two seconds (`lightRow`). Built with an injected `h` and `api`, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { keyWords } from "../../lib/format.js";
import { api } from "../lib/api.js";
import { getDotted, isLeaf, leafControlKind, valueWords } from "../lib/config-rows.js";
import { SHORTCUTS, comboOf } from "../shortcuts.js";
import { agentsPage, teamsOn } from "../../lib/teams-on.js";
import { state } from "../state.js";

/**
 * A row of a page as its list says it: a hand-drawn row by its label (`also`: the label it has in another state;
 * `words`: more words it is found by, `desc` where the page draws its description from the list; `start`: what its
 * page opens on to show it — a tab), one schema leaf by its `path` (`label` where the page names it otherwise), or a
 * schema group's leaves as the page draws them (`skip`: the paths it leaves out).
 * @typedef {{ label?: string, also?: readonly string[], desc?: string, words?: string, path?: string, group?: string,
 *   skip?: readonly string[], start?: string }} SearchRow
 */
/**
 * Where a result leads: its section; what the section opens on (`start`); the row, by its label or a selector.
 * `finish`: a plugin whose setup Library › Plugins & Connectors opens on at `start` (a plugin installed for a place, its server
 * over the web: its sign-in).
 * @typedef {{ section: string, start?: string, label?: string, also?: readonly string[], selector?: string, finish?: { plugin: string, title: string } }} Jump
 */
/** @typedef {{ label: string, where: string, desc: string, words: string, go: Jump }} Hit */
/** @typedef {{ id: string, group: string, label: string, title?: string }} Section  `title`: its page's own, found too */

/** The most results the list shows; the rest are counted under it. */
const SHOWN = 50;

/** @param {unknown} s */
const norm = (s) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
/** The schema's words as plain text. @param {unknown} s */
const plain = (s) => String(s || "").replace(/`/g, "");

/**
 * A group's leaves in the order its page draws them (lib/config-rows.js `group`): its own leaves, then each of its
 * groups' in turn; a skipped path, leaf or group, left out.
 * @param {any} schema @param {string} path @param {ReadonlySet<string>} skip @returns {[string, any][]}
 */
const groupLeaves = (schema, path, skip) => {
  const node = getDotted(schema?.config, path);
  if (!node || typeof node !== "object" || isLeaf(node)) return [];
  /** @type {[string, any][]} */
  const own = [];
  /** @type {string[]} */
  const inner = [];
  for (const [k, v] of Object.entries(node)) {
    const p = `${path}.${k}`;
    if (k === "_doc" || skip.has(p)) continue;
    if (isLeaf(v)) own.push([p, v]);
    else inner.push(p);
  }
  return [...own, ...inner.flatMap((p) => groupLeaves(schema, p, skip))];
};
/** A value inside an attribute selector. @param {unknown} s */
const quoted = (s) => `"${String(s).replace(/["\\]/g, "\\$&")}"`;

/**
 * The sections and the static rows: each section by its name and description, each page's listed rows, the shortcuts.
 * @param {readonly Section[]} sections @param {Record<string, string>} descriptions
 * @param {Record<string, readonly SearchRow[]>} rows
 * @returns {Hit[]}
 */
export function staticHits(sections, descriptions, rows) {
  /** @type {Hit[]} */
  const out = sections.map((s) => ({ label: s.label, where: s.group, desc: descriptions[s.id] || "", words: [s.id, s.title || ""].join(" ").trim(), go: { section: s.id } }));
  const labelOf = (/** @type {string} */ id) => sections.find((s) => s.id === id)?.label || id;
  for (const [section, list] of Object.entries(rows)) {
    for (const r of list) {
      if (r.path || r.group || !r.label) continue;
      out.push({ label: r.label, where: labelOf(section), desc: r.desc || "", words: [...(r.also || []), r.words || ""].join(" "), go: { section, label: r.label, ...(r.also ? { also: r.also } : {}), ...(r.start ? { start: r.start } : {}) } });
    }
  }
  /** @type {Set<string>} */
  const seen = new Set();
  for (const s of SHORTCUTS) {
    if (seen.has(s.label) || (s.id === "view-team" && !teamsOn(state.config))) continue;
    seen.add(s.label);
    out.push({ label: s.label, where: labelOf("shortcuts"), desc: "", words: [comboOf(s.id), "shortcut"].join(" "), go: { section: "shortcuts", label: s.label } });
  }
  return out;
}

/**
 * The schema-drawn rows: each page's listed leaves and groups over the schema and the configuration as read, found by
 * their label, their description, their path and their value (HC-113). A credential is no row.
 * @param {readonly Section[]} sections @param {Record<string, readonly SearchRow[]>} rows
 * @param {any} schema  `GET /api/schema` @param {any} state  `GET /api/state`
 * @returns {Hit[]}
 */
export function schemaHits(sections, rows, schema, state) {
  /** @type {Hit[]} */
  const out = [];
  const cfg = state?.config || {};
  for (const [section, list] of Object.entries(rows)) {
    const where = sections.find((s) => s.id === section)?.label || section;
    /** @param {string} path @param {any} leaf @param {SearchRow} [r] */
    const add = (path, leaf, r) => {
      // A credential's row says whether it is set (lib/config-rows.js): found by its words, never by its value.
      const secret = leaf?.type === "secret";
      if (!isLeaf(leaf) || (!secret && leafControlKind(leaf) === "none")) return;
      out.push({
        label: r?.label || keyWords(path.split(".").pop() || path),
        where,
        desc: r?.desc ?? plain(leaf.description),
        words: secret ? path : `${path} ${valueWords(getDotted(cfg, path))}`,
        go: { section, selector: `[data-path=${quoted(path)}]` },
      });
    };
    for (const r of list) {
      if (r.path) add(r.path, getDotted(schema?.config, r.path), r);
      if (r.group) for (const [path, leaf] of groupLeaves(schema, r.group, new Set(r.skip || []))) add(path, leaf);
    }
  }
  return out;
}

/**
 * Your things as Filament's reads answer them; a read that failed is left out. Your teams while Settings › Experimental's
 * Teams switch is on (`state`, /api/state's answer), your agents on the Library's page as the switch names it.
 * @param {{ upstreams?: any, models?: any, mcp?: any, agents?: any, saved?: any, teams?: any, state?: any }} r
 * @returns {Hit[]}
 */
export function thingHits(r) {
  /** @type {Hit[]} */
  const out = [];
  for (const u of (r.upstreams?.upstreams || []).filter((/** @type {any} */ u) => !u.agent)) {
    const name = String(u.name || u.id);
    const start = `provider:${u.id}`;
    out.push({ label: name, where: "Providers", desc: String(u.baseUrl || ""), words: `${u.id} provider`, go: { section: "providers", start } });
    // HC-74: each provider's key, or its account where it signs in instead.
    const row = u.type === "qoder" ? "Account" : "Key";
    out.push({ label: row, where: `Providers › ${name}`, desc: "", words: `${name} ${u.id}`, go: { section: "providers", start, label: row } });
  }
  // A model opens its provider's page at its row (the owner's settings cleanup of 11-09); a coding agent's, Coding agents.
  for (const x of r.models?.models || []) {
    const up = x.upstream || {};
    const members = (Array.isArray(x.members) ? x.members : []).map((/** @type {any} */ y) => (typeof y === "string" ? y : y?.id || ""));
    const words = [x.id, x.lead, ...members].join(" ");
    const label = String(x.label || x.id);
    if (up.agent) out.push({ label, where: `Coding agents › ${up.name || up.id || ""}`, desc: "", words, go: { section: "agents" } });
    else out.push({ label, where: `Providers › ${up.name || up.id || ""}`, desc: "", words, go: { section: "providers", start: `provider:${up.id}`, selector: `[data-family=${quoted(x.id)}]` } });
  }
  for (const s of r.mcp?.servers || []) {
    const spec = s.spec || {};
    const names = [...Object.keys(spec.env || {}), ...Object.keys(spec.headers || {})];
    out.push({
      label: String(s.name),
      where: "Library › Plugins & Connectors",
      desc: spec.url ? String(spec.url) : [spec.command, ...(Array.isArray(spec.args) ? spec.args : [])].filter(Boolean).join(" "),
      words: names.join(" "),
      go: { section: "mcp-servers", selector: `.mcps-row[data-name=${quoted(s.name)}]` },
    });
  }
  for (const e of r.agents?.entries || []) out.push({ label: String(e.name || e.id), where: "Coding agents", desc: "", words: String(e.id), go: { section: "agents", selector: `[data-agent=${quoted(e.id)}]` } });
  // A team's own card (`partOf`) is drawn in its team, so found only while Settings › Experimental's Teams switch is on.
  for (const c of [...(r.saved?.saved || []), ...(r.saved?.shipped || [])].filter((c) => teamsOn(r.state?.config) || !c.partOf)) {
    out.push({ label: String(c.name || c.tag), where: agentsPage(r.state?.config), desc: `@${c.tag}`, words: String(c.goodFor || ""), go: { section: "saved-agents", start: "agents", selector: `[data-tag=${quoted(c.tag)}]` } });
  }
  for (const t of teamsOn(r.state?.config) ? [...(r.teams?.saved || []), ...(r.teams?.shipped || [])] : []) {
    out.push({ label: String(t.name || t.key), where: "Library › Agents and teams", desc: "", words: `${t.key} team`, go: { section: "saved-agents", start: "groups", selector: `[data-key=${quoted(t.key)}]` } });
  }
  return out;
}

/** What each read is, in the words a failed one is named by. */
const READS = Object.freeze([
  { key: "upstreams", path: "/upstreams", what: "your providers" },
  { key: "models", path: "/model-routes", what: "your models" },
  { key: "mcp", path: "/mcp-servers?scope=all", what: "your connectors" },
  { key: "agents", path: "/coding-agents", what: "the coding agents" },
  { key: "saved", path: "/agents", what: "your agents" },
  { key: "teams", path: "/teams", what: "your teams" },
]);

/**
 * Everything the search reads, read at once: the schema-drawn rows and your things, and which reads failed, by why.
 * @param {(path: string, o?: any) => Promise<any>} call
 * @param {readonly Section[]} sections @param {Record<string, readonly SearchRow[]>} rows
 * @returns {Promise<{ hits: Hit[], failed: string[] }>}
 */
export async function readHits(call, sections, rows) {
  /** @type {string[]} */
  const failed = [];
  /** @param {unknown} e */
  const why = (e) => String(/** @type {any} */ (e)?.body?.error || /** @type {any} */ (e)?.message || e);
  const [config, ...things] = await Promise.all([
    Promise.all([call("/schema"), call("/state")]).catch((e) => { failed.push(`Filament's settings (${why(e)})`); return null; }),
    ...READS.map((x) => call(x.path).catch((e) => { failed.push(`${x.what} (${why(e)})`); return null; })),
  ]);
  /** @type {Record<string, any>} */
  const got = {};
  READS.forEach((x, i) => { got[x.key] = things[i]; });
  // Its settings' read failed, the switch is the page's own.
  got.state = config?.[1] ?? { config: state.config };
  return { hits: [...(config ? schemaHits(sections, rows, config[0], config[1]) : []), ...thingHits(got)], failed };
}

/**
 * The hits a query finds, best first: every word of it is somewhere in a hit's words; a label that is the query comes
 * first, then one that starts with it, holds it, holds each word, then the rest — each in the index's order.
 * @param {readonly Hit[]} hits @param {string} query @returns {Hit[]}
 */
export function findHits(hits, query) {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(" ");
  /** @type {[number, number, Hit][]} */
  const scored = [];
  hits.forEach((x, i) => {
    const label = norm(x.label);
    const own = `${label} ${norm(x.desc)} ${norm(x.words)}`;
    // Where a row is narrows a search, but never finds it alone: “key” is not every row of Keyboard Shortcuts.
    if (!terms.some((t) => own.includes(t)) || !terms.every((t) => own.includes(t) || norm(x.where).includes(t))) return;
    const rank = label === q ? 0 : label.startsWith(q) ? 1 : label.includes(q) ? 2 : terms.every((t) => label.includes(t)) ? 3 : 4;
    scored.push([rank, i, x]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((s) => s[2]);
}

/** The kinds of row a result lights, and the labels it is found by. */
const ROWS = ".settings-row, .prov-crow, .mcps-row, .mrow, .cag-card, .cag-item, .tset-card, .inst-how-item, .inst-how-more, .set-tr";
const LABELS = ".settings-row-label, .prov-crow-label, .inst-how-name, .inst-how-more-title, .set-tr-name, .nset-h";

/** A result opened on another page, held until that page takes it (`takeJump`). @type {Jump | null} */
let held = null;
/** A result to open on another page — another section, or the Library (library/page.js) — once it is drawn. @param {Jump} go */
export const holdJump = (go) => {
  held = go;
};
/**
 * The result held for a page that is drawn now, where it is one of its own; taken either way, so it lights once.
 * @param {(section: string) => boolean} mine @returns {Jump | null}
 */
export function takeJump(mine) {
  const go = held && mine(held.section) ? held : null;
  held = null;
  return go;
}

/**
 * The row a jump names in a drawn page, or null while it is not there.
 * @param {any} body @param {Jump} go @returns {any}
 */
export function findRow(body, go) {
  if (go.selector) return body.querySelector(go.selector);
  if (!go.label) return null;
  const want = [go.label, ...(go.also || [])].map(norm);
  const label = [...body.querySelectorAll(LABELS)].find((el) => want.includes(norm(el.textContent)));
  return label ? label.closest(ROWS) || label : null;
}

/** The watch of the row lit last: a new jump ends it. @type {(() => void) | null} */
let stopWatch = null;

/**
 * The row a jump names, once its page has drawn it: a closed part around it opened, scrolled to the middle and lit
 * for two seconds. A page that draws after a read is watched until the row comes, or the page goes; one that draws
 * again while the row is lit has its new row lit, so the light lasts its two seconds.
 * @param {any} body @param {Jump} go @param {{ later?: (fn: () => void, ms: number) => any }} [io]
 */
export function lightRow(body, go, io = {}) {
  stopWatch?.();
  stopWatch = null;
  if (!go.label && !go.selector) return;
  const later = io.later || ((fn, ms) => setTimeout(fn, ms));
  /** The row lit now. @type {any} */
  let lit = null;
  const light = () => {
    const row = findRow(body, go);
    if (!row || row === lit) return;
    for (let part = row.closest?.("details"); part; part = part.parentNode?.closest?.("details")) part.open = true;
    if (!lit) {
      row.scrollIntoView?.({ block: "center" });
      later(() => {
        lit.classList.remove("is-lit");
        stop();
      }, 2000);
    }
    lit?.classList.remove("is-lit");
    row.classList.add("is-lit");
    lit = row;
  };
  const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
    if (body.isConnected === false) stop();
    else light();
  });
  const stop = () => {
    watch?.disconnect();
    if (stopWatch === stop) stopWatch = null;
  };
  light();
  if (!watch) return;
  watch.observe(body, { childList: true, subtree: true });
  stopWatch = stop;
}

/** What the field holds across the page's draws: its words, the result marked, whether it had the focus. */
const kept = { query: "", marked: 0, focused: false };

/**
 * The field and its results, for the settings sidebar. `open` takes a result's jump; `onSearching` hears whether the
 * results are showing (the sections step aside while they are).
 * @param {{ sections: readonly Section[], descriptions: Record<string, string>,
 *   rows: Record<string, readonly SearchRow[]>, open: (go: Jump) => void, onSearching?: (on: boolean) => void }} o
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any> }} [io]
 */
export function settingsSearch(o, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const field = /** @type {any} */ (m("input", {
    class: "zc-input settings-search", type: "search", placeholder: "Search settings", "aria-label": "Search settings", spellcheck: "false",
    autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-controls": "settings-hits", "aria-autocomplete": "list",
  }));
  const results = m("div", { class: "settings-hits", id: "settings-hits", role: "listbox", "aria-label": "Found in Settings" });
  /** @type {Hit[]} */
  let hits = [];
  /** @type {string[]} */
  let failed = [];
  let reading = false;
  let read = false;
  /** @type {Hit[]} */
  let shown = [];

  const ensureRead = () => {
    if (read) return;
    read = true;
    reading = true;
    hits = staticHits(o.sections, o.descriptions, o.rows);
    void readHits(call, o.sections, o.rows).then((r) => {
      hits = [...hits, ...r.hits];
      failed = r.failed;
      reading = false;
      paint();
    });
  };

  /** @param {number} i */
  const openAt = (i) => {
    const x = shown[i];
    if (!x) return;
    kept.marked = i;
    kept.focused = globalThis.document?.activeElement === field;
    paint();
    o.open(x.go);
  };

  function paint() {
    const q = String(field.value || "");
    const on = !!q.trim();
    field.setAttribute("aria-expanded", on ? "true" : "false");
    o.onSearching?.(on);
    if (!on) {
      shown = [];
      results.replaceChildren();
      return;
    }
    const found = findHits(hits, q);
    shown = found.slice(0, SHOWN);
    kept.marked = Math.min(kept.marked, Math.max(0, shown.length - 1));
    /** @param {string} text @param {string} [kind] */
    const note = (text, kind = "") => m("p", { class: `settings-hits-note${kind ? ` is-${kind}` : ""}` }, text);
    /** @type {any[]} */
    const notes = [];
    if (!shown.length && !reading) notes.push(m("p", { class: "settings-hits-none" }, `Nothing in Settings matches “${q.trim()}”.`));
    if (found.length > SHOWN) notes.push(note(`${found.length - SHOWN} more: add a word to narrow it`));
    if (reading) notes.push(note("Reading your providers, models and agents…"));
    for (const f of failed) notes.push(note(`Not searched: ${f}`, "warn"));
    results.replaceChildren(
      ...shown.map((x, i) => m("button", {
        type: "button", class: `settings-hit${i === kept.marked ? " is-marked" : ""}`, role: "option", tabindex: "-1",
        "aria-selected": i === kept.marked ? "true" : "false",
        // The field keeps the focus, so ↓ ↑ and Enter go on from it after a click.
        onmousedown: (/** @type {any} */ e) => e.preventDefault(),
        onclick: () => openAt(i),
      }, m("span", { class: "settings-hit-label" }, x.label), m("span", { class: "settings-hit-where" }, x.where))),
      ...notes);
  }

  field.value = kept.query;
  field.oninput = () => {
    kept.query = String(field.value || "");
    kept.marked = 0;
    if (kept.query.trim()) ensureRead();
    paint();
  };
  field.onkeydown = (/** @type {any} */ e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!shown.length) return;
      e.preventDefault();
      kept.marked = (kept.marked + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      paint();
      results.querySelector(".settings-hit.is-marked")?.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (!shown.length) return;
      e.preventDefault();
      openAt(kept.marked);
    } else if (e.key === "Escape" && field.value) {
      // Esc empties the field and the sections come back; an empty field leaves Esc to the page.
      e.preventDefault();
      e.stopPropagation();
      field.value = "";
      field.oninput();
    }
  };
  if (kept.query.trim()) ensureRead();
  paint();

  return {
    field,
    results,
    /** Called once the field is in the page: it takes the focus back when a result was opened from it. */
    restore() {
      if (!kept.focused) return;
      kept.focused = false;
      field.focus?.();
    },
  };
}
