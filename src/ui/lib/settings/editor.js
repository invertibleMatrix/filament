// @ts-check
// One settings editor for every screen (HarnessV3 Step 2 D13): the harness's setup sheets and the dashboard's session
// and project panels all mount this. The section and row builders are here; the knobs knowledge lives beside them in
// knobs.js. `mode` decides what a row writes and shows: `session` — every knob, a badge saying where each value comes
// from, a reset per knob; `project` — the repo knobs of a project's own layer. The `doc` shape per mode: session —
// `GET /api/sessions/:id/settings` (flat, sources, layers); project — `GET /api/projects/:id/settings` (layer +
// resolved.flat/sources).
import { h } from "../dom.js";
import { fmt, keyBeside } from "../format.js";
import { SECTIONS, knobsOf, sectionLive, labelOf, knobWords, editorFor, formatValue, parseInput, ruleLine, hookLine, docParts, docWords, TEAM_KNOBS } from "./knobs.js";

// The hands the loop has today; the schema's list (`loop.tools` options) also names the ones a later phase brings,
// drawn as switches that do not move yet.
const TOOL_NAMES = ["read", "write", "edit", "bash", "powershell", "grep", "glob", "ask", "plan", "agent", "delegate_read", "web_fetch", "web_search"];

/**
 * @typedef {object} EditorCallbacks
 * @property {(change: { patch?: any, unset?: string[] }) => void} change  write the layer being edited
 * @property {() => string} [draft]  the composer's draft, for the dry-run turn
 * @property {(msg: string, kind?: string) => void} [toast]
 */

/**
 * The source badge: which layer a value came from. @param {string} from @param {typeof h} [mk]
 */
function badge(from, mk = h) {
  const text = from === "default" ? "default" : from;
  return mk("span", { class: `zc-badge row-badge src-${from}`, title: from === "default" ? "the schema's default: no layer names this setting" : `this value comes from the ${from} layer` }, text);
}

/** The knobs whose lists add up across the layers: the MCP servers by name, the folders it may read by path. */
export const ADDS_UP = new Set(["plugins.mcp", "loop.addedFolders"]);

/**
 * A row's label (HarnessV3-Launch LD-D10): the knob in words, then its short key in mono when the key says something
 * the words don't; a compact row (the widgets') shows the words alone. The dotted path is the tooltip either way.
 * @param {string} path @param {string} name  the row's words @param {boolean} compact @param {typeof h} [mk]
 */
export function knobLabel(path, name, compact, mk = h) {
  const key = compact ? null : keyBeside(labelOf(path));
  return mk("span", { class: "knob-label", title: path }, name, key ? mk("span", { class: "knob-key" }, key) : null);
}

/**
 * One knob's row: label, editor, badge, reset (when the edited layer holds a value of its own). Exported for the composer's widgets (Facade D8): there is never a second row implementation;
 * the widgets pass `density: "compact"` — value, source badge, reset, no doc paragraph — and may name the row in
 * their own words (`label`), else it is named by the one rule (`knobWords`); a refusal names it the same way.
 * @param {string} path @param {import("./knobs.js").KnobInfo} k @param {any} doc @param {EditorCallbacks} cb
 * @param {{ mode: "session" | "project", flat: Record<string, any>, sources: Record<string, string>, own: string | null, filamentRuns?: boolean, density?: "compact", label?: string,
 *   derived?: Record<string, { path: string, value: any, why: string, note?: string }>, teams?: boolean }} view
 *   `teams` false: Settings › Experimental's Teams switch is off, and the tools' switches name no team tool
 * @param {typeof h} [mk]  the page's `h`, or a test's stand-in
 */
export function knobRow(path, k, doc, cb, view, mk = h) {
  const { mode, own } = view;
  const flat = view.flat || {};
  const sources = view.sources || {};
  // A list whose layers add up (HarnessV4_Settings_Plan HS-D7) is edited as the layer's own: the resolved value is
  // every layer's, and written back it would copy the broader layers' entries into this one.
  const ownLayer = mode === "project" ? doc?.layer : mode === "session" ? doc?.layers?.session : null;
  const value = ADDS_UP.has(path) && ownLayer ? (path.split(".").reduce((/** @type {any} */ n, p) => n?.[p], ownLayer) ?? ownLayer[path]) : flat[path];
  const from = sources[path] || "default";
  // The derivation's badge (Step 6 §1.4): nobody chose this knob, something else requires it — say which, and
  // what it would cost to choose differently. An explicit choice replaces the derivation, so the badge only ever
  // sits beside "default".
  const d = view.derived?.[path];
  const derivedBadge = from === "default" && d
    ? mk("span", { class: "zc-badge row-badge src-derived", title: `${d.why}.${d.note ? ` ${d.note}.` : ""} An explicit choice here always wins over the derivation.` }, "derived on")
    : null;
  const editor = editorFor(path, k);
  const name = view.label || knobWords(path);
  const set = (/** @type {any} */ v) => cb.change({ patch: { [path]: v } });
  const unset = () => cb.change({ unset: [path] });
  /** @type {HTMLElement} */
  let control;
  if (!k.live) {
    control = mk("span", { class: "knob-inert", title: docWords(k.doc) }, formatValue(path, k, value), mk("span", { class: "knob-phase" }, `phase ${k.phase}`));
  } else if (editor === "bool") {
    const box = mk("input", { type: "checkbox", ...(value ? { checked: "" } : {}) });
    box.addEventListener("change", () => set(box.checked));
    control = mk("span", { class: "check" }, box, value ? " on" : " off");
  } else if (editor === "enum") {
    const opts = [...(k.nullable || k.default === null ? [""] : []), ...(k.options || [])];
    const sel = mk("select", {}, ...opts.map((o) => mk("option", { value: o, ...(String(value ?? "") === o ? { selected: "" } : {}) }, o ? o : "–")));
    // The blank option: the edited layer's value goes back to inheriting; an inherited non-null value is overridden with an explicit null (the knob allows one), so a project's choice can
    // be switched off for this session alone; an inherited null already is the blank, so nothing is written.
    sel.addEventListener("change", () => {
      if (sel.value !== "") return set(sel.value);
      if (from === own) return unset();
      if (value !== null && value !== undefined) set(null);
    });
    control = sel;
  } else if (editor === "tools") {
    const tools = value && typeof value === "object" ? value : {};
    const names = [...new Set([...TOOL_NAMES, ...(k.options || [])])].filter((n) => view.teams !== false || n !== "team");
    control = mk("span", { class: "tool-switches" },
      ...names.map((name) => {
        const box = mk("input", { type: "checkbox", ...(tools[name] !== false ? { checked: "" } : {}) });
        box.addEventListener("change", () => {
          const next = { ...tools };
          if (box.checked) delete next[name];
          else next[name] = false;
          Object.keys(next).length ? set(next) : unset();
        });
        const web = name === "web_fetch" || name === "web_search";
        return mk("label", { class: "tool-switch", title: `${name}: ${box.checked ? "offered" : "switched off"}${web ? " (rides only when plugins.web switches it on)" : ""}` }, box, name);
      }),
      // A chat's tools are its first request's (team_v2_plan TV2-D7): a switch turned in its own settings changes them
      // under its cache, which it says before it is turned.
      ...(mode === "session" ? [mk("span", { class: "knob-note" }, "A switch turned here changes the tools this chat's next request carries: its cache starts fresh once.")] : []));
  } else if (editor === "rules") {
    // Read-only (HarnessV3-AtHome AH-D7): a rule is remembered where you said Always allow, and forgotten from the
    // harness's permission switch, which lists the rules in force in words. Nobody writes one by hand here.
    const rules = Array.isArray(value) ? value : [];
    control = mk("span", { class: "knob-rules" },
      ...(rules.length ? rules.map((r) => mk("code", { class: "knob-rule" }, r && typeof r === "object" ? ruleLine(r) : String(r))) : [mk("span", { class: "knob-rules-none" }, "none")]),
      mk("span", { class: "knob-rules-note" }, "Listed in words on the harness's permission switch, each with Forget"));
  } else if (editor === "hooks") {
    // One hook per line in the short form; a bad line is refused with its own words and nothing is written.
    const lines = Array.isArray(value) ? value.map((x) => hookLine(x)).join("\n") : "";
    const area = mk("textarea", { class: "knob-json knob-lines", rows: String(Math.min(8, Math.max(2, lines.split("\n").length + 1))), spellcheck: "false", placeholder: "post-tool(edit) npm test\nturn-end npm run typecheck timeout=120000" }, lines);
    const apply = mk("button", { class: "sm", type: "button" }, "apply");
    apply.addEventListener("click", () => {
      const r = parseInput(path, k, area.value, editor, name);
      if ("error" in r) return cb.toast?.(r.error, "err");
      "unset" in r ? unset() : set(r.value);
    });
    control = mk("span", { class: "knob-json-wrap" }, area, apply);
  } else if (editor === "json") {
    const area = mk("textarea", { class: "knob-json", rows: "3", spellcheck: "false" }, value === undefined || value === null ? "" : JSON.stringify(value, null, 1));
    const apply = mk("button", { class: "sm", type: "button" }, "apply");
    apply.addEventListener("click", () => {
      const r = parseInput(path, k, area.value, editor, name);
      if ("error" in r) return cb.toast?.(r.error, "err");
      "unset" in r ? unset() : set(r.value);
    });
    control = mk("span", { class: "knob-json-wrap" }, area, apply);
  } else {
    const input = mk("input", { type: editor === "number" ? "number" : "text", class: "knob-input", value: value === undefined || value === null ? "" : editor === "text-list" && Array.isArray(value) ? value.join(", ") : String(value), placeholder: from === "default" && (value === null || value === undefined) ? "–" : "" });
    if (editor === "number" && k.type === "int") input.setAttribute("step", "1");
    input.addEventListener("change", () => {
      // A number field with letters in it reads as empty to us — the browser flags it, and an empty field would unset.
      if (editor === "number" && input.validity?.badInput) return cb.toast?.(`${name} needs a number`, "err");
      const r = parseInput(path, k, input.value, editor, name);
      if ("error" in r) return cb.toast?.(r.error, "err");
      if ("unset" in r) {
        if (from === own) return unset();
        if (value === null || value === undefined) return;
        return k.nullable || k.default === null ? set(null) : cb.toast?.(`${name} needs a value`, "err");
      }
      set(r.value);
    });
    control = input;
  }
  // The reach badge (D13): an filament-reach knob in a session whose turns Filament does not run (it composes them in
  // the harness) would sit silently unenforced — the row says so instead.
  const reachNote = mode === "session" && !view.filamentRuns && k.reach === "filament"
    ? mk("span", { class: "zc-badge row-badge src-reach", title: "obeyed when Filament runs the session's turns (the harness); a direct-to-model chat never reads it" }, "harness")
    : null;
  return mk("div", { class: `knob ${k.live ? "" : "is-inert"}${view.density === "compact" ? " knob-compact" : ""}`, "data-path": path },
    mk("div", { class: "knob-line" },
      knobLabel(path, name, view.density === "compact", mk),
      control,
      badge(from, mk),
      derivedBadge,
      from === own && k.live ? mk("button", { class: "sm ghost knob-reset", type: "button", title: `drop this ${own} layer's own value and inherit again`, onclick: unset }, "↺") : null,
      reachNote),
    // The schema's own words, visible: a knob that explains itself is the difference between a settings page
    // and a debug panel. The dotted path stays on the label's tooltip. The widgets' compact density leaves it
    // out — the popover is a glance, not a page. Drawn in the page's words (`docParts`): code in mono, an unset value
    // "not set".
    view.density === "compact" ? null : mk("p", { class: "knob-doc" }, ...docParts(k.doc).map((p) => (p.code ? mk("code", {}, p.text) : p.text))));
}

/** The session view's `derived` list (Step 6 §1.4) as the map the rows read: path → its derivation. @param {any} doc */
export function derivedOf(doc) {
  return Object.fromEntries((Array.isArray(doc?.derived) ? doc.derived : []).map((/** @type {any} */ d) => [d.path, d]));
}

/**
 * One section card: its knobs — filtered by the mode's scope (project: repo knobs) — or, with
 * nothing live in it, the "not built yet" card listing what each knob will do. `parts`: a page's own part in place of a
 * knob's row, by its path (the harness's MCP servers list for `plugins.mcp`). `teams` false: Settings › Experimental's
 * Teams switch is off, and no knob of teams is offered (knobs.js `TEAM_KNOBS`).
 * @param {import("./knobs.js").Section} section @param {any} doc @param {EditorCallbacks} cb
 * @param {Record<string, any>} extras @param {{ mode?: "session" | "project", filamentRuns?: boolean, parts?: Record<string, HTMLElement>, teams?: boolean }} [o]
 */
export function sectionCard(section, doc, cb, extras, { mode = "session", filamentRuns = false, parts = {}, teams = true } = {}) {
  const knobs = doc.knobs || {};
  const scopeOfKnob = (/** @type {string} */ p) => (mode === "project" ? knobs[p]?.scope !== "mode" && knobs[p]?.scope !== "session" : true);
  const paths = knobsOf(section, knobs).filter((p) => knobs[p] && scopeOfKnob(p) && (teams || !TEAM_KNOBS.includes(p)));
  if (!paths.length) return null;
  const view = {
    mode: /** @type {"session" | "project"} */ (mode),
    filamentRuns,
    flat: mode === "project" ? doc.resolved?.flat ?? doc.flat : doc.flat,
    sources: mode === "project" ? doc.resolved?.sources ?? doc.sources : doc.sources,
    own: mode === "project" ? "project" : "session",
    derived: mode === "session" ? derivedOf(doc) : undefined,
    teams,
  };
  const live = sectionLive(section, knobs);
  const phases = [...new Set(paths.map((p) => knobs[p].phase))].sort();
  const head = h("div", { class: "insp-head" },
    h("h4", {}, section.title),
    live ? null : h("span", { class: "zc-badge row-badge", title: `every setting here lands in phase ${phases.join("/")}` }, `not built yet · phase ${phases[0]}`),
    extras[section.id] || null);
  const body = live
    ? h("div", { class: "knobs" }, ...paths.map((p) => parts[p] || knobRow(p, knobs[p], doc, cb, view)))
    : h("div", { class: "insp-notbuilt" },
        h("p", { class: "muted small" }, section.blurb),
        h("ul", {}, ...paths.map((p) => h("li", {}, h("code", {}, labelOf(p)), " — ", ...docParts(knobs[p].doc).map((x) => (x.code ? h("code", {}, x.text) : x.text))))));
  return h("section", { class: `s-block insp-section ${live ? "" : "is-notbuilt"}`, "data-section": section.id }, head, live ? h("p", { class: "muted small insp-blurb" }, section.blurb) : null, body);
}

/**
 * The editor itself: the section cards of `doc` under `mode`, all of §5's sections or the named subset.
 * @param {{ doc: any, cb: EditorCallbacks, mode?: "session" | "project", sections?: string[] | null, extras?: Record<string, any>, filamentRuns?: boolean, teams?: boolean }} o
 */
export function settingsEditor({ doc, cb, mode = "session", sections = null, extras = {}, filamentRuns = false, teams = true }) {
  const list = sections ? sections.map((id) => SECTIONS.find((/** @type {any} */ s) => s.id === id)).filter(Boolean) : SECTIONS;
  return h("div", { class: `settings-ed is-${mode}` }, ...list.map((/** @type {any} */ s) => sectionCard(s, doc, cb, extras, { mode, filamentRuns, teams })).filter(Boolean));
}

/**
 * The settings history: one line per change, newest first (shared by the harness's History tab and the dashboard's
 * session Settings).
 * @param {any} history
 */
export function historyList(history) {
  if (!history) return h("div", { class: "muted small" }, "loading the history…");
  const entries = history.entries || [];
  if (!entries.length) return h("div", { class: "muted small" }, history.note || "no settings changes recorded for this session");
  return h("ul", { class: "insp-history" },
    ...entries.map((e) => h("li", {},
      h("span", { class: "insp-history-when", title: e.at }, fmt.t(e.at)),
      h("span", { class: `zc-badge row-badge src-${e.layer}` }, e.layer),
      h("span", { class: "insp-history-what" }, e.changes?.length ? e.changes.join(" · ") : e.title))));
}

/**
 * Top-level-flatten a nested layer into dotted paths, with the leaf rule the registry uses: `loop.tools` is a single
 * knob that holds an object, not a section. The editor reads and writes this shape.
 * @param {any} doc @param {string} [prefix]
 * @returns {Record<string, any>}
 */
export function flattenLayer(doc, prefix = "") {
  /** @type {Record<string, any>} */
  const out = {};
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return out;
  for (const [k, v] of Object.entries(doc)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null || typeof v !== "object" || Array.isArray(v) || path === "loop.tools") out[path] = v;
    else Object.assign(out, flattenLayer(v, path));
  }
  return out;
}

/**
 * The inverse of `flattenLayer`: dotted paths back into the nested layer the API takes. The Start board sends its
 * held changes through it.
 * @param {Record<string, any>} flat
 */
export function nestLayer(flat) {
  /** @type {any} */
  const out = {};
  for (const [path, v] of Object.entries(flat || {})) {
    const parts = String(path).split(".");
    let node = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) node[p] = v;
      else node = node[p] ||= {};
    });
  }
  return out;
}
