// @ts-check
import { ui } from "../runtime.js";
import { learnsWith } from "../lib/claims.js";

// A virtual model is a route whose match is one plain name (no *, no re:) with at least one backup: clients ask for the
// name, Filament walks the list. Memory can use such a name as its model.
const isPlainName = (/** @type {any} */ m) => !!m && !String(m).includes("*") && !String(m).startsWith("re:");
const isVirtualRoute = (/** @type {any} */ r) => isPlainName(r.match) && (r.fallbacks || []).length > 0;
/** What memory's model does, in the harness's words (HarnessV3-Launch LD-D10); the key sits beside them. */
const MODEL_WORDS = Object.freeze({ summarizer: "Memory's model" });

// Memory → Settings → Memory's model (HarnessV3-Memory M6-6, the memory plan's m1): the one model memory learns, curates
// and rewrites searches with, first for every memory call; not set, each chat's compaction model, else its own. A picker
// over its fixed choices, your virtual models and every model a route answers, with a custom name for anything else;
// saved with the page's Save. Its effort is the harness's Settings › Memory's.
export function memoryModelsPanel(S, M) {
  const { state, modelCatalog, upDisplay, markDirty, api, goto, md, h } = /** @type {any} */ (ui);
  const c = state.config; const cat = modelCatalog();
  const virtual = c.routes.filter((r) => r.enabled !== false && isVirtualRoute(r));
  const byUp = new Map();
  for (const m of cat?.models || []) { if (virtual.some((r) => r.match === m.id)) continue; if (!byUp.has(m.upstream)) byUp.set(m.upstream, []); byUp.get(m.upstream).push(m.id); }
  const known = new Set([...virtual.map((r) => r.match), ...[...byUp.values()].flat()]);
  /**
   * One picker for `M.models[key]`: `fixed` first ([value, label]; the first is what an empty custom name writes), then
   * the models, then custom…. `cur`: the value as set, read the way memory reads it (so "auto" and "" pick the same row).
   * @param {keyof typeof MODEL_WORDS} key @param {[string, string][]} fixed @param {string} cur
   */
  const picker = (key, fixed, cur) => {
    const isCustom = !fixed.some(([v]) => v === cur) && (cat ? !known.has(cur) : !virtual.some((r) => r.match === cur));
    const custom = h("input", { type: "text", class: "mono", value: isCustom ? cur : "", placeholder: "model name, exactly as a client would ask for it" });
    const wrap = h("label", { class: "grow", style: isCustom ? "" : "display:none" }, "custom name", custom);
    custom.oninput = () => { M.models[key] = custom.value.trim() || fixed[0][0]; markDirty(); };
    const opt = (v, label) => h("option", { value: v, selected: v === (isCustom ? "__custom__" : cur) ? "" : null }, label);
    const sel = h("select", {},
      ...fixed.map(([v, l]) => opt(v, l)),
      virtual.length ? h("optgroup", { label: "Your virtual models" }, ...virtual.map((r) => opt(r.match, `${r.match}  ·  ${[r.upstream, ...r.fallbacks.map((f) => f.upstream)].map(upDisplay).join(" → ")}`))) : null,
      ...[...byUp].map(([up, ids]) => h("optgroup", { label: upDisplay(up) }, ...ids.sort().map((id) => opt(id, id)))),
      opt("__custom__", "custom…"));
    sel.onchange = () => { if (sel.value === "__custom__") { wrap.style.display = ""; custom.focus(); M.models[key] = custom.value.trim() || fixed[0][0]; } else { wrap.style.display = "none"; M.models[key] = sel.value; } markDirty(); };
    const words = h("span", {}, MODEL_WORDS[key], h("span", { class: "field-key", title: `memory.models.${key}` }, `models.${key}`));
    return h("div", { class: "row", style: "margin:10px 0 0" }, h("label", { class: "grow" }, words, sel), wrap);
  };
  /** The knob's own words from the schema. @param {string} key */
  const doc = (key) => { const leaf = S.models?.[key] || {}; return h("p", { class: "muted small", style: "margin:6px 0 0", html: `${md(leaf.description || "")}${leaf.effect ? " <b>Effect:</b> " + md(leaf.effect) : ""}` }); };
  const set = (v) => String(v ?? "").trim();
  // What each one is now, as the server reads the saved config.
  const now = h("div", { class: "muted small", style: "margin:10px 0 0" }, "reading which model memory uses now…");
  api("/memory/models").then(({ models: ms }) => {
    const lw = learnsWith(ms);
    now.replaceChildren(
    lw.model ? h("span", {}, lw.chosen ? "Not set: each chat's compaction model, else its own; where no chat is named, " : "Memory works with ", h("code", {}, lw.model)) : h("span", { class: lw.off ? "" : "warn" }, `Memory learns nothing from finished sessions: ${lw.why}`),
    ...(ms.curatorUsesModel === false ? [" · the curator works by rule alone"] : []),
    ".");
  }).catch(() => now.replaceChildren());
  const learns = set(M.models.summarizer);
  return h("section", { class: "panel", id: "memsettings-models" }, h("h2", {}, "Memory's model"), h("p", { class: "muted small", html: md(S.models._doc || "") }),
    picker("summarizer", [["", "not set — each chat's compaction model, else the chat's own model"], ["off", "off — memory learns nothing from finished sessions"]], learns === "auto" ? "" : learns),
    doc("summarizer"),
    now,
    cat ? null : h("p", { class: "muted small", style: "margin:4px 0 0" }, "Loading the model lists…"),
    virtual.length ? null : h("p", { class: "muted small", style: "margin:4px 0 0" }, "Tip: a virtual model such as ", h("code", {}, "free-model"), " chains several providers' free models under one name and can be picked here. ", goto("routes", "Create one on the Routes page →", "new-virtual")));
}
