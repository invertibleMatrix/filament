/* Filament settings UI. Vanilla JS, no build step. Every form is generated from the server's schema so each
   parameter shows its description and effect. Shared helpers live in ./lib so the future harness page
   (and an Electron shell that loads the same files) never copies them. */
import { $, h, setHtml, commitFocused } from "./lib/dom.js";
import { fmt, serverBase, upstreamWords, sessionWords } from "./lib/format.js";
import { billingWords } from "./lib/cost.js";
import { learnsWith } from "./lib/claims.js";
import { store } from "./lib/store.js";
import { api, setViewOnly, viewOnlyNow, viewOnlyOf } from "./lib/api.js";
import { listenerSet } from "./lib/listeners.js";
import { holdWhileShown } from "./lib/put-away.js";
import { leaveIfRefused } from "./lib/standing.js";
import { esc, md, mdDoc, mdBlock } from "./lib/md.js";
import { createSchemaForm, isLeaf, flatten, mergedRules as mergeRuleLayers } from "./components/schema-form.js";
import { openDrawer, closeDrawer, bindDrawer, diffView, drawerHolds } from "./components/drawer.js";
import { spark } from "./components/charts.js";
import { createPalette } from "./components/palette.js";
import { createRequestsTable, phaseOf, statusPill, failStep, failoverTrail, whereWent, liveCells, streamedOf, QUIET_WORDS } from "./components/requests-table.js";
import { createGetStarted, createStartReader, startActions } from "./components/get-started.js";
import { engineLine } from "./components/engine-line.js";
import { followEngine, RESTART_WORDS, restartEngine } from "./lib/engine.js";
import { followAccounts } from "./lib/accounts.js";
import { isAgentUp } from "./lib/upstream-kinds.js";
import { state, bindUi, setReqFilter, REQ_FILTER_DEFAULTS } from "./runtime.js";
import { PAGES, HOME_PANES, HOME_SUB, HUBS, TAB_ALIAS, CONFIG_TABS, navId, parseHash, formatHash, palettePages } from "./nav.js";
import { copyline, secretLine, CHROME } from "./copy.js";
import { concepts, guide, docs } from "./pages/docs.js";
import { overview } from "./pages/home.js";
import { usage } from "./pages/usage.js";
import { requests } from "./pages/traffic.js";
import { routes, upstreams, models } from "./pages/destinations.js";
import { prefixRouteOf } from "./lib/providers.js";
import { followConfig } from "./lib/config-follow.js";
import { memory, memories, projects, sessions, activity, memusage, memsettings, memGate } from "./pages/memory.js";
import { rules, templates, settings, prompts } from "./pages/settings.js";
import { assistant } from "./pages/assistant.js";
import { dryrun, playground } from "./pages/lab.js";

// What each client-bridge mode actually means, for the tooltip on the "bridge in force" column. The column shows
// what the last turn really got, not what the upstream is configured for: `native` needs an agent that can switch
// its built-in tools off, so a configured `native` on any other agent silently behaves as `full`, and saying so is
// the whole point of the column.
const BRIDGE_HINT = {
  native: "the agent's own tools are OFF; every read, write and command runs through your chat client's tools, so they render as native cards",
  full: "the agent keeps its own tools but may delegate reads, writes and commands to your chat client",
  prompts: "only permission questions and the plan go to your chat client; the agent does the work itself and it is narrated as text",
  off: "the agent does everything itself and never interacts with your chat client",
};
// The modes to explain, ordered most to least capable but TAKEN FROM THE SCHEMA: a hard-coded list is in sync today
// and silently omits any mode added later, which is how a setting ends up selectable but unexplained.
const BRIDGE_MODES = ["native", "full", "prompts", "off"];
function bridgeModes(schema) {
  const opts = schema?.upstream?.acp?.clientBridge?.options;
  if (!Array.isArray(opts) || !opts.length) return BRIDGE_MODES;
  return [...BRIDGE_MODES.filter((m) => opts.includes(m)), ...opts.filter((m) => !BRIDGE_MODES.includes(m))];
}
function empty(title, hint) { return h("div", { class: "empty" }, h("b", {}, title), hint ? h("span", { class: "small" }, hint) : null); }
function setStatus(kind, text) { const d = $("#status-dot"); d.className = `dot ${kind}`; $("#status-text").textContent = text; }
const qs = new URLSearchParams(location.search);
function applyTheme(t) {
  t = ["light", "dark", "midnight", "contrast"].includes(t) ? t : "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  store.set("theme", t);
  for (const b of document.querySelectorAll("#theme button")) b.classList.toggle("on", b.dataset.theme === t);
}
function applyAccent(a) {
  a = ["indigo", "teal", "amber", "mono"].includes(a) ? a : "indigo";
  document.documentElement.setAttribute("data-accent", a);
  store.set("accent", a);
  for (const b of document.querySelectorAll("#accent button")) b.classList.toggle("on", b.dataset.accent === a);
}
function applyDensity(d) {
  d = d === "compact" ? "compact" : "comfortable";
  document.documentElement.setAttribute("data-density", d);
  store.set("density", d);
  for (const b of document.querySelectorAll("#density button")) b.classList.toggle("on", b.dataset.density === d);
}
function applyNav(mode) {
  mode = mode === "collapsed" ? "collapsed" : "expanded";
  document.documentElement.setAttribute("data-nav", mode);
  store.set("nav", mode);
  const btn = $("#nav-toggle");
  if (btn) { btn.title = mode === "collapsed" ? CHROME.expandNav : CHROME.collapseNav; btn.setAttribute("aria-label", btn.title); }
}
applyTheme(qs.get("theme") || store.get("theme") || "auto");
applyAccent(qs.get("accent") || store.get("accent") || "indigo");
applyDensity(qs.get("density") || store.get("density") || "comfortable");
applyNav(store.get("nav") || "expanded");
$("#status-text").textContent = CHROME.connecting;
$("#dirty").textContent = CHROME.unsaved;
$("#discard").textContent = CHROME.discard;
$("#discard").title = CHROME.discardTitle;
$("#save").textContent = CHROME.save;
$("#appear-btn").textContent = CHROME.appearance;
state.homePane = store.get("home.pane") || "status";
$("#nav-toggle").onclick = () => applyNav(document.documentElement.dataset.nav === "collapsed" ? "expanded" : "collapsed");
$("#theme").onclick = (e) => { const t = e.target.closest("button")?.dataset.theme; if (t) applyTheme(t); };
$("#accent").onclick = (e) => { const a = e.target.closest("button")?.dataset.accent; if (a) applyAccent(a); };
$("#density").onclick = (e) => { const d = e.target.closest("button")?.dataset.density; if (d) applyDensity(d); };
function closePops() { $("#help-pop")?.classList.add("hidden"); $("#appear-pop")?.classList.add("hidden"); }
function closePalette() { $("#palette")?.classList.add("hidden"); }
function placePop(pop, btn) {
  const r = btn.getBoundingClientRect();
  pop.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
  pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
  pop.style.top = "auto";
  pop.classList.remove("hidden");
}
$("#btn-help").onclick = (e) => { e.stopPropagation(); const pop = $("#help-pop"); const open = pop.classList.contains("hidden"); closePops(); if (open) { for (const b of pop.querySelectorAll("button")) b.classList.toggle("on", b.dataset.tab === state.tab); placePop(pop, e.currentTarget); } };
$("#appear-btn").onclick = (e) => { e.stopPropagation(); const pop = $("#appear-pop"); const open = pop.classList.contains("hidden"); closePops(); if (open) placePop(pop, e.currentTarget); };
$("#help-pop").onclick = (e) => { const t = e.target.closest("button")?.dataset.tab; if (t) go(t); };
$("#btn-assistant").onclick = () => go("assistant");
document.addEventListener("click", (e) => {
  if (!e.target.closest("#help-pop, #appear-pop, #btn-help, #appear-btn")) closePops();
});
// Small counters on the sidebar: requests in flight, errors in the last hour.
function navBadges() {
  // One per turn (R6): a model call or a sub-agent's turn whose turn is in flight too is part of it, not another.
  const pending = state.requests.filter((r) => r.status === "pending");
  const pendingIds = new Set(pending.map((r) => r.id));
  const inflight = pending.filter((r) => ![r.agentOf, r.subagentOf].some((p) => p && pendingIds.has(p))).length;
  const hourAgo = Date.now() - 3600000;
  const errs = state.requests.filter((r) => r.status === "error" && new Date(r.ts).getTime() > hourAgo).length;
  // Operations count toward the Traffic badge too: a cooldown, a refused compaction or a failed job is exactly the kind
  // of thing the badge exists to pull you toward, and none of them are requests. Warnings and errors only, in the last
  // hour, so a busy but healthy server does not wear a permanent red dot.
  const opBad = (state.ops || []).filter((o) => (o.level === "warn" || o.level === "error") && new Date(o.ts).getTime() > hourAgo).length;
  const set = (tab, text, cls) => { const b = $(`#tabs button[data-tab="${tab}"]`); if (!b) return; let el = b.querySelector(".badge"); if (!text) { el?.remove(); return; } if (!el) { el = h("span", { class: "badge" }); b.append(el); } el.className = `badge ${cls || ""}`; el.textContent = text; el.title = tab === "overview" ? `${inflight} request(s) in flight` : `${errs} failed request(s)${opBad ? ` + ${opBad} warning/error operation(s)` : ""} in the last hour`; };
  set("overview", inflight ? `${inflight} live` : "", "live");
  const bad = errs + opBad;
  set("requests", bad ? String(bad) : "", "err");
}
// Collapsible "how this page works" box, remembered per page. Closed unless the user opened it.
function intro(key, ...content) {
  const open = store.get(`intro.${key}`) === "open";
  const d = h("details", { class: "intro" }, h("summary", {}, h("span", { class: "intro-icon" }, "?"), "How this page works", h("span", { class: "muted small grow", style: "text-align:right" }, open ? "click to hide" : "click to show")), h("div", { class: "intro-body" }, ...content));
  if (open) d.setAttribute("open", "");
  d.addEventListener("toggle", () => { store.set(`intro.${key}`, d.open ? "open" : "closed"); d.querySelector("summary .grow").textContent = d.open ? "click to hide" : "click to show"; });
  return d;
}
const goto = (tab, label, section = null) => h("a", { href: `#${tab}${section ? ":" + section : ""}`, class: "golink", onclick: (e) => { e.preventDefault(); go(tab, section); } }, label || PAGES[tab]?.[0] || tab);
function go(tab, section = null) {
  if (tab === "overview" && section && HOME_PANES.some(([id]) => id === section)) { state.tab = "overview"; state.homePane = section; store.set("home.pane", section); state.section = null; }
  else { state.tab = TAB_ALIAS[tab] || tab; state.section = section; }
  closePops(); closePalette(); render(); if (!section || HOME_PANES.some(([id]) => id === section)) window.scrollTo(0, 0);
}
const rx = (pattern) => { try { return new RegExp(pattern, "i"); } catch { return null; } };
const bare = (m) => String(m || "").replace(/^[a-z0-9_-]+\//i, "");
// Provider comparison tables used on the Concepts page.
// A comparison table; `prose` when its fourth column is words, not a figure (figures stay on one line, right-aligned).
function cmpTable(cols, rows, { prose = false } = {}) { return h("div", { class: "table-wrap" }, h("table", { class: `small cmp${prose ? " prose" : ""}` }, h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", {}, c)))), h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((cell, i) => h("td", { html: md(cell), class: i === 0 ? "cmp-head" : "" }))))))); }
function section(id, title, ...content) { return h("section", { class: "panel concept", id: `concepts-${id}` }, h("h2", {}, title), ...content); }
// "cursor · ACP agent", "anthropic · Anthropic API": upstream ids alone are ambiguous once qoder and qoder-cloud exist.
function upLabel(u) { if (!u) return "?"; const t = state.schema?.upstreamTypes?.[u.type]; const kind = u.type === "acp" ? "ACP agent" : u.type === "qoder" ? "Qoder cloud" : (t?.label || u.type || "").replace(/ \(.*\)$/, ""); return `${u.id} · ${kind}${u.enabled === false ? " (disabled)" : ""}`; }
// Removing an upstream takes the routes that point only at it along, hands routes that have a backup to that backup,
// and drops it from every failover order, so Save changes never fails on a route pointing at a provider that is gone.
function removeUpstream(c, u, i) {
  const routes = c.routes || []; const primary = routes.filter((r) => r.upstream === u.id);
  const promote = primary.filter((r) => (r.fallbacks || []).some((f) => f.upstream && f.upstream !== u.id)); const drop = primary.filter((r) => !promote.includes(r));
  const inFallbacks = routes.filter((r) => r.upstream !== u.id && (r.fallbacks || []).some((f) => f.upstream === u.id));
  const nextOf = (r) => (r.fallbacks || []).find((f) => f.upstream && f.upstream !== u.id);
  // Its prefix route (Providers D1) is named on its own: it is the provider's, and goes with it.
  const own = prefixRouteOf(c, u.id); const rest = drop.filter((r) => r !== own);
  const lines = [`Remove ${u.name || u.id}?`];
  if (own) lines.push(`Its prefix route goes with it: ${own.match}.`);
  if (rest.length) lines.push(`${rest.length} other route${rest.length === 1 ? "" : "s"} point${rest.length === 1 ? "s" : ""} only at it and ${rest.length === 1 ? "goes" : "go"} too (a route to a provider that is gone could not be saved): ${rest.map((r) => r.match).join(", ")}.`);
  if (promote.length) lines.push(`${promote.length} route${promote.length === 1 ? "" : "s"} will go to the next provider in the failover order instead: ${promote.map((r) => `${r.match} → ${nextOf(r).upstream}`).join(", ")}.`);
  if (inFallbacks.length) lines.push(`It is also dropped from the failover order of ${inFallbacks.map((r) => r.match).join(", ")}.`);
  if (!drop.length && !promote.length && !inFallbacks.length) lines.push("No route points at it.");
  if (!confirm(lines.join("\n"))) return;
  for (const r of promote) { const fbs = (r.fallbacks || []).filter((f) => f.upstream && f.upstream !== u.id); const first = fbs.shift(); r.upstream = first.upstream; if (first.upstreamModel != null && String(first.upstreamModel).trim() !== "") r.upstreamModel = first.upstreamModel; r.fallbacks = fbs; }
  c.routes = routes.filter((r) => !drop.includes(r)); for (const r of c.routes) if (r.fallbacks?.length) r.fallbacks = r.fallbacks.filter((f) => f.upstream !== u.id);
  c.upstreams.splice(i, 1); markDirty();
  toast(`${u.name || u.id} removed${drop.length ? ` with ${drop.length} route${drop.length === 1 ? "" : "s"}` : ""}${promote.length ? `; ${promote.length} route${promote.length === 1 ? "" : "s"} moved to the next provider` : ""}. Press Save changes.`);
  render();
}
// Plain-language sentence for a route row.
function routeMeaning(r, c, shown = {}) { // `shown` = the example the table already displays, so the sentence and the column agree
  const u = c.upstreams.find((x) => x.id === r.upstream);
  const where = u ? (isAgentUp(u) ? `the ${u.name || u.id} agent` : u.name || u.id) : `upstream "${r.upstream}" (missing)`;
  const [pre, post = ""] = String(r.match ?? "").split("*");
  const cap = r.match.includes("*") ? (isAgentUp(u) ? "some-model" : u?.type === "qoder" ? "lite" : /claude-$/i.test(pre) ? "fable-5-1" : "claude-fable-5-1") : r.match;
  const ex = shown.ex || (r.match.includes("*") ? `${pre}${cap}${post}` : r.match);
  const sent = shown.sent || (r.upstreamModel || "{model}").replace(/\{model\}/g, ex).replace(/\{1\}/g, cap);
  const fmt2 = r.format && r.format !== "auto" ? ` Sent as ${r.format} format (translated if needed).` : "";
  const strat = { round_robin: "Requests alternate between", random: "Requests are spread randomly over", least_latency: "The fastest-responding of", least_cost: "The cheapest of", quota_aware: "The least exhausted of" }[r.strategy];
  const fb = (r.fallbacks || []).length ? (strat ? ` ${strat} ${[r.upstream, ...r.fallbacks.map((f) => f.upstream)].map(upDisplay).join(", ")} is used; any that is cooling down after failures goes last.` : ` If ${where} fails (${FAIL_CAUSES}), the request moves to ${r.fallbacks.map((f) => upDisplay(f.upstream)).join(", then ")}.`) : "";
  return `${r.enabled === false ? "Off. " : ""}Names like “${ex}” go to ${where}, which receives “${sent}”.${fmt2}${fb}`;
}
// ---- failover: helpers shared by the route editor, the virtual-model builder, the Traffic page and Memory → Settings ----
// Display name of an upstream id, without the "(agent via ACP)" suffix that only earns its place on the Upstreams page.
const upDisplay = (id) => { const words = upstreamWords(id); if (words) return words; const u = state.config?.upstreams.find((x) => x.id === id); return u ? (u.name || u.id).replace(" (agent via ACP)", "") : `${id || "?"} (missing)`; };
const STRATEGIES = [
  ["in_order", "Priority order", "row 1 first; the next row only when the one before fails (the only strict order)"],
  ["round_robin", "Take turns", "requests alternate over the whole list"],
  ["random", "Random", "each request picks one row at random"],
  ["least_latency", "Fastest lately", "whichever row answered fastest recently"],
  ["least_cost", "Cheapest", "the row with the lowest price per token for this model"],
  ["quota_aware", "Most quota left", "the least exhausted row"],
];
const FAIL_CAUSES = "rate limit, outage, unreachable, unknown model, bad key";
// One GET /api/models shared by every picker: agent-facing names (effort variants hidden) plus, per upstream, the raw
// names it advertised. Returns null while loading and re-renders the pages that use it once the list is in.
function modelCatalog() {
  if (state._catalog) return state._catalog;
  if (!state._catalogPending) {
    state._catalogPending = api("/models").then((m) => {
      const models = (m.models || []).filter((x) => x.source !== "effort-variant");
      state._catalog = { models, perUpstream: Object.fromEntries(Object.entries(m.upstreams || {}).map(([id, v]) => [id, [...new Set(v.all || [])]])) };
      state._modelNames = models.map((x) => x.id);
      if (["routes", "memsettings"].includes(state.tab)) render();
    }).catch(() => { state._catalog = { models: [], perUpstream: {} }; });
  }
  return null;
}
const {
  requestsTable, failoverPill, viewPill, cutPill, memPill, sourcePill, stopReqBtn, trailLines,
} = createRequestsTable({ state, openRequest, render, api, toast, upDisplay, empty });

function failoverCard(d) {
  const fo = failoverTrail(d); if (!fo) return null;
  // What a failed entry said in full, where that is more than its headline (HarnessV4_Tasks B10).
  const whole = (t) => (t.detail ? h("details", { class: "small" }, h("summary", { class: "muted" }, "All it said"), h("pre", { class: "small fo-said" }, t.detail)) : null);
  return h("div", { class: "card fo-card" }, h("h4", {}, "Failover"), h("p", { class: "muted small", style: "margin:0" }, fo.servedBy ? "The first provider did not answer, so the next one in this route's failover order took over:" : "Nobody in this route's failover order answered:"),
    h("ol", { class: "fo-trail" }, ...fo.trail.map((t) => h("li", {}, t.text ? t.text : [h("b", {}, upDisplay(t.upstream)), ` — ${failStep(t)}`, whole(t)])), fo.servedBy ? h("li", { class: "served" }, h("b", {}, upDisplay(fo.servedBy)), " — served", d.attempt ? ` (attempt ${d.attempt})` : "") : null),
    h("p", { class: "muted small", style: "margin:6px 0 0" }, "Change the order on the ", goto("routes", "Routes page"), "."));
}
// Plain-English reading of a chain [{ upstream, upstreamModel }] (row 0 = primary) for the name a client asks for.
// sentFor() turns a model template into what the provider would actually receive.
function failoverSentence(name, chain, strategy = "in_order", { sentFor = (tpl) => tpl } = {}) {
  const rows = chain.filter((c) => c.upstream);
  if (!rows.length) return h("span", { class: "warn" }, "Add at least one provider.");
  const step = (c, i) => h("span", { class: "fo-step" }, h("b", {}, `${i + 1} → ${upDisplay(c.upstream)}`), " (", h("code", {}, sentFor(String(c.upstreamModel ?? "").trim() || "{model}")), ")");
  const head = h("span", {}, "When a client asks for ", h("code", {}, name || "…"), ": ");
  if ((strategy || "in_order") !== "in_order") {
    const s = STRATEGIES.find((x) => x[0] === strategy);
    return h("span", {}, head, `requests are spread over ${rows.length} providers (${s ? s[1].toLowerCase() : strategy}: ${s ? s[2] : ""}): `, ...rows.flatMap((c, i) => [i ? " · " : "", step(c, i)]), ". A provider that is cooling down after failures goes last; when the chosen one fails, the others are tried. When all fail, the client gets the last error.");
  }
  const parts = [head, step(rows[0], 0), "."];
  rows.slice(1).forEach((c, i) => parts.push(i === 0 ? ` If that fails (${FAIL_CAUSES}): ` : " Then ", step(c, i + 1), "."));
  parts.push(rows.length > 1 ? " When all fail, the client gets the last error." : h("span", { class: "muted" }, " No backup yet: if it fails, the client gets that error. Press “+ Add the next provider”."));
  return h("span", {}, ...parts);
}
// The numbered failover list. get() returns the chain, set(arr) writes it back, redraw() rebuilds the surrounding editor
// after a structural change, live() refreshes the sentence while a model name is typed, onEdit() marks the draft dirty.
function failoverRows({ get, set, redraw, live, onEdit, minRows = 1, defaultModel = "{model}", placeholder = "{model}" }) {
  const c = state.config; const cat = modelCatalog(); const chain = get(); const uid = Math.random().toString(36).slice(2, 8);
  const rows = chain.map((row, i) => {
    const u = c.upstreams.find((x) => x.id === row.upstream); const names = cat?.perUpstream?.[row.upstream] || [];
    const sel = h("select", { "aria-label": `provider ${i + 1}` }, ...(row.upstream && !u ? [h("option", { value: row.upstream, selected: "" }, `${row.upstream} (missing)`)] : []), ...c.upstreams.map((x) => h("option", { value: x.id, selected: x.id === row.upstream ? "" : null }, `${upDisplay(x.id)}  ·  ${kindOf(x)}${x.enabled === false ? "  (disabled)" : ""}`)));
    sel.onchange = () => { const next = get(); next[i] = { ...next[i], upstream: sel.value }; set(next); onEdit?.(); redraw(); };
    const dl = h("datalist", { id: `fo-${uid}-${i}` }, h("option", { value: "{model}" }, "same name the client asked for"), ...names.map((m) => h("option", { value: m })));
    const inp = h("input", { type: "text", class: "mono", list: dl.id, value: row.upstreamModel ?? "", placeholder, autocomplete: "off", "aria-label": `model on provider ${i + 1}` });
    inp.oninput = () => { const next = get(); next[i] = { ...next[i], upstreamModel: inp.value }; set(next); onEdit?.(); live?.(); };
    inp.onchange = () => redraw();
    const move = (d) => { const next = get(); const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; set(next); onEdit?.(); redraw(); };
    return h("div", { class: `fo-row${i === 0 ? " primary" : ""}` },
      h("span", { class: "fo-num", title: i === 0 ? "tried first" : `tried when the ${i === 1 ? "row" : "rows"} above ${i === 1 ? "fails" : "fail"}` }, String(i + 1)),
      h("label", {}, i === 0 ? "first" : "then", sel),
      h("label", { class: "grow" }, `model ${u ? upDisplay(u.id) : "it"} receives`, inp, dl),
      h("span", { class: "fo-btns" },
        h("button", { class: "icon", title: "move up", disabled: i === 0 ? "" : null, onclick: () => move(-1) }, "▲"),
        h("button", { class: "icon", title: "move down", disabled: i === chain.length - 1 ? "" : null, onclick: () => move(1) }, "▼"),
        h("button", { class: "icon danger", title: chain.length <= minRows ? "the list needs at least one row" : "remove this row", disabled: chain.length <= minRows ? "" : null, onclick: () => { const next = get(); next.splice(i, 1); set(next); onEdit?.(); redraw(); } }, "✕")),
      cat && row.upstream && !names.length ? h("span", { class: "muted small fo-note" }, u && isAgentUp(u) ? "A coding agent: it picks its own model unless you name one." : "This provider has not advertised a model list yet; type the name it expects.") : null,
      !cat ? h("span", { class: "muted small fo-note" }, "loading model names…") : null);
  });
  const add = h("button", { class: "sm", onclick: () => { const next = get(); const used = new Set(next.map((x) => x.upstream)); const pick = c.upstreams.find((x) => x.enabled !== false && !used.has(x.id) && !isAgentUp(x)) || c.upstreams.find((x) => x.enabled !== false && !used.has(x.id)) || c.upstreams.find((x) => !used.has(x.id)) || c.upstreams[0]; next.push({ upstream: pick?.id || "", upstreamModel: defaultModel }); set(next); onEdit?.(); redraw(); } }, "+ Add the next provider");
  return h("div", { class: "fo-list" }, ...rows, h("div", { class: "row", style: "margin:8px 0 0" }, add, h("span", { class: "muted small" }, "Rows are tried top to bottom. ▲ ▼ change the order.")));
}
// Live "does this model name reach a route?" tester. Uses the SAVED config on the server.
function routeTester(placeholder = "claude-fable-5-1-max") {
  const inp = h("input", { type: "text", class: "mono", placeholder, value: placeholder }); const out = h("div", { class: "tester-out muted small" }, "Type a model name exactly as the agent would send it, then press Test.");
  const run = async () => {
    const model = inp.value.trim(); if (!model) return;
    try {
      const r = await api("/dry-run", { method: "POST", body: { format: "anthropic", body: { model, max_tokens: 1024, messages: [{ role: "user", content: "hi" }] } } });
      const suffix = r.requested?.effort ? h("li", {}, "Effort suffix found: ", h("code", {}, `-${r.requested.effort}`), ` → effort `, h("b", {}, r.requested.effort), `, name used for matching: `, h("code", {}, r.requested.base)) : h("li", {}, "No effort suffix, so the name is matched as-is: ", h("code", {}, r.requested?.base || model));
      if (!r.ok) return out.replaceChildren(h("ul", { class: "steps-list" }, suffix, h("li", { class: "err" }, r.error), h("li", {}, "Fix: add a route whose match covers this name, for example ", h("code", {}, (r.requested?.base || model).split("-")[0] + "-*"), ".")));
      const sentModel = r.body?.model;
      out.replaceChildren(h("ul", { class: "steps-list" }, suffix, h("li", {}, "Matched route ", h("code", {}, r.route), " (first match from the top)"), h("li", {}, "Goes to upstream ", h("b", {}, r.upstream), " at ", h("code", {}, r.url)), h("li", {}, "Model name the upstream receives: ", h("code", {}, sentModel)), h("li", {}, r.changes?.length ? `${r.changes.length} rule change(s) would apply: ${r.changes.join("; ")}` : "No rule changes for this minimal request.")), ...(state.dirty ? [h("p", { class: "warn small" }, "You have unsaved edits. The tester uses the last saved routes; press Save changes first to test the new ones.")] : []));
    } catch (e) { out.replaceChildren(h("span", { class: "err" }, e.message)); }
  };
  inp.onkeydown = (e) => { if (e.key === "Enter") run(); };
  return h("div", { class: "tester" }, h("div", { class: "row", style: "margin:0 0 8px" }, h("label", { class: "grow" }, "model name the agent asks for ", inp), h("button", { class: "primary", onclick: run }, "Test")), out);
}
function flowDiagram() {
  const box = (title, sub, cls = "") => h("div", { class: `flow-box ${cls}` }, h("b", {}, title), h("span", { class: "small muted" }, sub));
  const arrow = (label) => h("div", { class: "flow-arrow" }, h("span", {}, "→"), label ? h("small", {}, label) : null);
  return h("div", { class: "flow" },
    box("Your agent", "Claude Code, Cursor, any SDK", "flow-agent"), arrow("asks for a model name, sends messages"),
    box("Route", "which upstream handles this name?", "flow-shim"), arrow("first match wins"),
    box("Rules", "fix · fill · remove parameters", "flow-shim"), arrow("same format, corrected"),
    box("Upstream", "OpenAI- or Anthropic-compatible server, Anthropic, OpenAI, or a coding agent", "flow-up"), arrow("streams the answer back"),
    box("Your agent", "sees thinking, effort, usage", "flow-agent"));
}
function toast(msg, kind = "ok") { const t = $("#toast"); t.textContent = msg; t.className = `toast ${kind} show`; clearTimeout(state._toast); state._toast = setTimeout(() => t.classList.remove("show"), 3500); }
// A view-only device's console saves nothing, so an edit there is never unsaved: it holds no live redraw back.
function markDirty(v = true) { if (v && viewOnlyNow()) return; state.dirty = v; $("#dirty").classList.toggle("hidden", !v); $("#discard").classList.toggle("hidden", !v); $("#save").disabled = !v; syncSaveBar(); }
function syncSaveBar() { $("#config-actions").classList.toggle("idle", !(CONFIG_TABS.has(state.tab) || state.dirty)); }
const { schemaForm } = createSchemaForm({ toast });

// ---------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------
const views = {
  concepts, guide, docs, overview, usage, requests,
  routes, upstreams, models,
  memory, memories, projects, sessions, activity, memusage, memsettings,
  rules, templates, settings, prompts, assistant, dryrun, playground,
};


// ---------------------------------------------------------------------------------------------------
// Memory hub helpers. Memory and archive content is user data: it is always placed as text nodes, never as HTML.
// ---------------------------------------------------------------------------------------------------
const memAgo = (ts) => { if (!ts) return "–"; const d = new Date(ts); if (isNaN(d)) return String(ts); const ms = Date.now() - d.getTime(); if (ms < 60000) return "just now"; if (ms < 3600000) return `${Math.max(1, Math.round(ms / 60000))} min ago`; if (ms < 86400000) return `${(ms / 3600000).toFixed(1)} h ago`; if (ms < 7 * 86400000) return `${Math.round(ms / 86400000)} d ago`; return d.toLocaleDateString(); };
const memWhen = (ts) => { if (!ts) return "–"; const d = new Date(ts); return isNaN(d) ? String(ts) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); };
const memBytes = (n) => (n == null ? "–" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
const memPrefix = () => state.config?.memory?.commands?.prefix || "@mem";
// GET /memory/status, cached for five seconds so the Home card and the hub tabs do not hammer it on re-renders.
async function memStatus({ probe = false, fresh = false } = {}) {
  if (!probe && !fresh && state.memStatus && Date.now() - (state.memStatusAt || 0) < 5000) return state.memStatus;
  const st = await api(`/memory/status${probe ? "?probe=1" : ""}`); state.memStatus = st; state.memStatusAt = Date.now(); return st;
}
function memEnginePill(st) {
  if (!st?.enabled) return h("span", { class: "pill mem-engine-pill" }, "off");
  const e = st.engine || {}; const s = e.state || "missing";
  const map = { ready: ["ok", "ready"], starting: ["warn", "starting…"], stopped: ["", "idle"], degraded: ["warn", "degraded"], missing: ["err", "not installed"] };
  const [cls, label] = map[s] || ["", s];
  return h("span", { class: `pill ${cls} mem-engine-pill`, title: e.lastError || (s === "degraded" ? "three failures in a row; the brain runs on the archive alone until the next successful start" : s === "stopped" ? "starts with the first request that needs it" : "") }, label);
}
function memKindPill(kind) { const k = String(kind || "memory"); return h("span", { class: "pill", title: `kind: ${k}` }, k); }

// The lineage graph of one session, as inline SVG: nodes are sessions (ancestors to the left, later sessions to
// the right of the current one), solid edges are continues/child, dashed edges are loaded. No dependencies; the
// layout is one column per depth, stacked within a column by date.
function memLineageSvg(lin, onSelect) {
  const W = 158, H = 52, COL = 190, ROW = 74, PAD = 16;
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, ...children) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); for (const c of children) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
  const depths = new Map();
  for (const n of lin.nodes || []) { const d = Math.trunc(n.depth || 0); if (!depths.has(d)) depths.set(d, []); depths.get(d).push(n); }
  const ds = [...depths.keys()].sort((a, b) => a - b);
  const pos = new Map();
  for (const d of ds) depths.get(d).sort((a, b) => (a.when || 0) - (b.when || 0)).forEach((n, i) => pos.set(n.id, { x: PAD + (d - ds[0]) * COL, y: PAD + i * ROW, n }));
  const rowsMax = Math.max(...ds.map((d) => depths.get(d).length));
  const width = PAD * 2 + (ds.length - 1) * COL + W, height = PAD * 2 + rowsMax * ROW + 6;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "mem-lineage", role: "img" });
  for (const e of lin.edges || []) {
    const a = pos.get(e.src), b = pos.get(e.dst); if (!a || !b) continue;
    svg.append(el("line", { x1: a.x, y1: a.y + H / 2, x2: b.x + W, y2: b.y + H / 2, class: `mem-edge ${e.type}`, ...(e.type === "loaded" ? { "stroke-dasharray": "5 4" } : {}) }, el("title", {}, `${e.src} ${e.type} ${e.dst}`)));
  }
  for (const [id, p] of pos) {
    const n = p.n;
    const g = el("g", { class: `mem-node${n.current ? " current" : ""}`, transform: `translate(${p.x},${p.y})`, ...(onSelect ? { role: "button", tabindex: 0 } : {}) },
      el("rect", { width: W, height: H, rx: 10 }),
      el("text", { x: 10, y: 19, class: "mono" }, `${n.id}${n.current ? " · this" : ""}`),
      el("text", { x: 10, y: 35 }, sessionWords(n).slice(0, 22)),
      el("text", { x: 10, y: 46, class: "dim" }, `${fmt.n(n.turns || 0)} turns · ${memAgo(n.when)}`));
    if (onSelect) g.addEventListener("click", () => onSelect(id));
    svg.append(g);
  }
  return svg;
}
// A link that opens one session on the Sessions tab (also works from inside the request drawer).
function memSessionLink(id, label) {
  if (!id) return h("span", { class: "muted" }, "–");
  return h("a", { href: `#memory:sessions:${encodeURIComponent(String(id))}`, class: "golink mono small", title: "Open this session on Memory → Sessions", onclick: (e) => { e.preventDefault(); closeDrawer(); state.memSel = String(id); go("sessions"); } }, label || String(id));
}
function memOffPanel(what = "this page") {
  return h("section", { class: "panel" }, h("div", { class: "empty" }, h("b", {}, "Memory is off"), h("span", { class: "small" }, "Nothing is captured or recalled. Turn it on under ", goto("memsettings", "Memory → Settings"), ", press Save changes, and ", what, " fill in from the first request. The engine can be installed from the Overview afterwards.")));
}
// Live progress for an install or update job: polls GET /memory/jobs/:id every second while the panel is on screen.
// Leaving the page stops the polling; the Overview picks a running job up again from status.jobs. The engine's
// install runs with no clock (HarnessV3-FailurePoints FP-D3), so a step that hangs ends by hand: the
// job says it can be stopped (`stoppable`), the panel's Stop asks (POST /memory/jobs/:id/stop), and one the person
// stopped reads stopped, never failed (`stopped`; HarnessV4_Tasks U1).
function memJobPanel(job, onDone) {
  const box = h("div", { class: "mem-job" });
  const ENGINE_STEPS = ["uv", "python", "venv", "package", "model", "verify"];
  // Step pills per job kind: an install walks the engine steps, after the backup when one runs first (over an engine
  // of another Mnemosyne version); an import has its source step, then learn (not for a Mnemosyne database, which is
  // copied without learning); a backfill is learn alone.
  const stepsFor = (kind, progress) => (kind === "install" ? [...(progress.some((p) => p.step === "backup") ? ["backup"] : []), ...ENGINE_STEPS] : /^import-/.test(kind || "") ? [kind.slice(7)] : kind === "learn-backfill" ? ["learn"] : [...new Set(progress.map((p) => p.step).filter(Boolean))]);
  const titleFor = (kind) => ({ install: "Installing the memory engine", "import-claude-code": "Importing Claude Code sessions","import-mnemosyne": "Importing a Mnemosyne database", "learn-backfill": "Learning from archived sessions" }[kind] || `Job ${kind || job.id}`);
  const engineJob = job.kind === "install";
  // A job can end "done" while its RESULT says ok:false — it refused instead of crashing. Render that as refused,
  // not as a green 100% bar: the bar keeps the real percent it died at and the reason is shown in red.
  const refusedJob = (j) => j.status === "done" && !engineJob && j.result && typeof j.result === "object" && j.result.ok === false;
  let stopping = false;
  const stop = async () => { stopping = true; draw(shown); try { const r = await api(`/memory/jobs/${encodeURIComponent(job.id)}/stop`, { method: "POST" }); if (!r?.stopped) { stopping = false; toast("It had ended already"); } } catch (e) { stopping = false; draw(shown); toast(e.message, "err"); } };
  let shown = job;
  const draw = (j) => {
    shown = j;
    const done = j.status === "done", err = j.status === "error", refused = refusedJob(j), stopped = err && !!j.stopped;
    const progress = Array.isArray(j.progress) ? j.progress : []; const last = progress[progress.length - 1];
    const pct = Math.max(0, Math.min(100, Math.round(j.percent || (last?.percent != null ? last.percent : last?.total ? ((last.done || 0) / last.total) * 100 : 0)))); // learning reports done/total, not a percent
    const finished = new Set(progress.filter((p) => p.status === "done" || p.status === "ok" || p.status === "skipped").map((p) => p.step));
    const cur = [...progress].reverse().find((p) => p.step)?.step;
    box.replaceChildren(h("div", {},
      h("div", { class: "row", style: "margin:0 0 4px;align-items:center;gap:10px" }, h("b", {}, titleFor(j.kind)), refused ? h("span", { class: "pill err" }, "refused") : done ? h("span", { class: "pill ok" }, "done") : stopped ? h("span", { class: "pill" }, "stopped") : err ? h("span", { class: "pill err" }, "failed") : h("span", { class: "pill warn" }, last?.total ? `${fmt.n(last.done || 0)} of ${fmt.n(last.total)}${last.step === "learn" ? " sessions" : ""}` : `${pct}%`), h("span", { class: "grow" }), h("span", { class: "muted small" }, done || err ? "" : "you can leave this page; it keeps going"), !done && !err && j.stoppable ? h("button", { class: "sm", disabled: stopping ? "" : null, title: "End this job now: the step it is on is stopped where it stands. Nothing here ends it by itself, however long a step takes.", onclick: stop }, stopping ? "Stopping…" : "Stop") : null),
      h("div", { class: "mem-progress" }, h("i", { class: stopped ? "" : err || refused ? "bad" : done ? "ok" : "", style: `width:${done && !refused ? 100 : pct}%` })),
      h("div", { class: "mem-steps small" }, ...stepsFor(j.kind, progress).map((s) => h("span", { class: `pill ${finished.has(s) || (done && !refused) ? "ok" : s === cur && !err ? "warn" : ""}` }, s))),
      h("div", { class: "small", style: "margin-top:6px" }, stopped ? h("span", { class: "muted" }, `You stopped it${cur ? ` at its ${cur} step` : ""}. Start it again when you want.`) : err || refused ? h("span", { class: "err" }, j.error || j.result?.reason || (refused ? "refused" : "failed")) : h("span", { class: "muted" }, j.message || (done ? (engineJob ? "Ready. The engine starts with the next request." : "Done.") : "starting…"))),
      done && j.result && typeof j.result === "object" && !engineJob ? memSummary(j.result) : null,
      progress.length ? h("details", { class: "small", style: "margin:6px 0 0" }, h("summary", {}, `Log (${progress.length} lines)`), h("pre", { class: "small mem-log" }, progress.slice(-60).map((p) => `${p.at ? new Date(p.at).toLocaleTimeString() : "        "}  ${p.step ? p.step + ": " : ""}${p.message || p.status || ""}`).join("\n"))) : null));
  };
  draw(job);
  if (job.status === "running") {
    const tick = async () => {
      if (!box.isConnected) return;
      let j; try { j = await api(`/memory/jobs/${encodeURIComponent(job.id)}`); } catch (e) { box.append(h("div", { class: "err small" }, `Lost the job: ${e.message}`)); return; }
      draw(j);
      if (j.status === "running") setTimeout(tick, 1000); else { state.memStatus = null; const refused = refusedJob(j); toast(j.status === "done" ? (refused ? `${titleFor(j.kind)} refused: ${j.result?.reason || ""}` : engineJob ? "Memory engine ready" : `${titleFor(j.kind)}: done`) : j.stopped ? `${titleFor(j.kind)}: stopped` : `${titleFor(j.kind)} failed: ${j.error || ""}`, (j.status === "done" && !refused) || j.stopped ? "ok" : "err"); onDone?.(j); }
    };
    setTimeout(tick, 1000);
  }
  return box;
}
// Get started's facts (HarnessV3-Launch LD-D2): what /api/start answers, read with the config and again while Home or
// Start here shows them; a change draws the page again.
const starts = createStartReader({ api, changed: () => { if (["overview", "guide"].includes(state.tab)) render(); } });
function startFacts() { return starts.get(); }
const refreshStart = () => { state.memStatus = null; void starts.read(); };
// What Get started's clicks do: memory's switch reaches both of the page's copies of the config.
const startActs = startActions({ api, toast, refresh: refreshStart, copies: () => [state.config, state.saved] });
// The one Get-started builder (LD-D2), for Home and Start here.
const getStarted = createGetStarted({
  h, copyline, secretLine,
  jobPanel: (job, onDone) => memJobPanel(job, onDone),
  settingsLink: (label) => goto("memsettings", label),
  connect: () => { state.addUp = true; go("upstreams"); },
  memoryOn: startActs.memoryOn,
  install: startActs.install,
  listModels: startActs.listModels,
  refresh: refreshStart,
  open: () => { store.set("home.getStarted", "open"); render(); },
});
// Backups: last backup and destination, "Back up now", the list on disk with Restore. compact = the Overview card.
function memBackupsPanel({ compact = false } = {}) {
  const box = h("div", { class: "mem-backups" }, h("span", { class: "muted small" }, "loading backups…"));
  const load = () => api("/memory/backups").then((b) => {
    const list = Array.isArray(b.backups) ? b.backups : [];
    const canRun = !!b.folder && b.destinationExists !== false;
    const runBtn = h("button", { class: compact ? "sm" : "", disabled: !canRun || b.running ? "" : null, title: canRun ? "Take a consistent copy of the memory folder now (SQLite online backup, gzipped, with checksums)" : "Set a destination folder under Settings → Backups first", onclick: async () => { runBtn.disabled = true; runBtn.textContent = "backing up…"; try { const m = await api("/memory/backup", { method: "POST", body: {} }); toast(`Backup written · ${memBytes(m?.bytes)}`); } catch (e) { toast(e.message, "err"); } load(); } }, b.running ? "backing up…" : "Back up now");
    const restore = async (e) => {
      if (!confirm(`Restore the backup ${e.name} from ${memWhen(e.at)}?\n\nIts checksums are verified, then the live archive and Mnemosyne database are replaced by the backup's copies. The memory engine stops for a moment and starts again afterwards. Anything remembered since that backup is lost, and so are the chats made since. Chats deleted since come back; any of their Undo points you ticked away in a Space's Clean up are gone, so those chats cannot fork or rewind at those turns.`)) return;
      try { const r = await api("/memory/restore", { method: "POST", body: { dir: e.dir } }); toast(Array.isArray(r?.restored) ? `Restored ${r.restored.length} file${r.restored.length === 1 ? "" : "s"}` : "Backup restored"); state.memStatus = null; render(); } catch (err) { toast(err.message, "err"); }
    };
    const head = h("div", { class: "row", style: "margin:0 0 6px;align-items:center;gap:10px" },
      h("span", { class: "small" }, b.last ? h("span", {}, "Last backup ", h("b", {}, memAgo(b.last.at)), ` · ${memBytes(b.last.bytes)} · ${fmt.n(b.count)} kept`) : h("span", { class: "muted" }, !b.folder ? "No destination folder yet." : b.destinationExists === false ? "The destination folder does not exist yet." : "No backup taken yet.")),
      h("span", { class: "grow" }), runBtn);
    const rows = compact ? list.slice(0, 3) : list;
    const statePill = (e) => (e.broken ? h("span", { class: "pill err" }, "unreadable") : h("span", { class: "pill ok", title: "manifest present; checksums are verified on restore" }, "manifest ok"));
    const table = rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...(compact ? ["backup", "when", "size", ""] : ["backup", "when", "size", "files", "state", ""]).map((t) => h("th", {}, t)))), h("tbody", {}, ...rows.map((e) => h("tr", {},
      h("td", {}, h("code", { class: "mem-path", title: e.dir || "" }, e.name || "?"), compact && e.broken ? h("div", {}, statePill(e)) : null), h("td", { class: "muted small", style: "white-space:nowrap" }, e.at ? memAgo(e.at) : "–"), h("td", { class: "num", style: "white-space:nowrap" }, memBytes(e.bytes)),
      compact ? null : h("td", { class: "num" }, fmt.n((e.files || []).length)), compact ? null : h("td", {}, statePill(e)),
      h("td", { class: "acts" }, e.broken ? null : h("button", { class: "sm danger", title: "Replace the live databases with this backup", onclick: () => restore(e) }, "Restore"))))))) : null;
    box.replaceChildren(h("div", {}, head, table,
      compact && list.length > 3 ? h("p", { class: "muted small", style: "margin:6px 0 0" }, `${fmt.n(list.length - 3)} more under `, goto("memsettings", "Settings → Backups", "backups")) : null,
      !compact && list.length ? h("p", { class: "muted small", style: "margin:8px 0 0" }, "Restore verifies every file's checksum, replaces the live databases and restarts the engine. A copy that drifted in cloud sync is refused.") : null));
  }).catch((e) => box.replaceChildren(h("p", { class: "err small" }, e.message)));
  load();
  return box;
}
// Import past sessions: the sources found on this machine (Claude Code, a Hermes Mnemosyne database), one
// Import button each, running jobs shown with the job panel. Progress carries file names and ids, never text.
function memImportPanel() {
  const box = h("div", {}, h("span", { class: "muted small" }, "looking for past sessions on this machine…"));
  const jobs = h("div", {});
  const learnCb = h("input", { type: "checkbox" }); learnCb.checked = true;
  Promise.all([api("/memory/sources"), memStatus()]).then(([src, st]) => {
    if (src.error) return box.replaceChildren(h("p", { class: "err small" }, src.error));
    for (const j of (st.jobs || []).filter((j) => j.status === "running" && /^import-/.test(j.kind || ""))) jobs.append(memJobPanel(j, () => { state.memStatus = null; }));
    const start = async (body, label) => { try { const { job } = await api("/memory/import", { method: "POST", body: { ...body, learn: learnCb.checked } }); jobs.append(memJobPanel(job, () => { state.memStatus = null; })); toast(label); } catch (e) { toast(e.message, "err"); } };
    const cc = src.claudeCode || {}, hz = src.hermes || {}; const cands = Array.isArray(hz.candidates) ? hz.candidates : [];
    const source = (name, pill, what, ...rest) => h("div", { class: "mem-source" }, h("div", { class: "mem-source-main" }, h("div", { class: "row", style: "margin:0;align-items:center;gap:8px" }, h("b", {}, name), pill), h("div", { class: "muted small" }, what), ...rest.slice(0, -1)), h("div", { class: "mem-source-act" }, rest[rest.length - 1]));
    const found = (ok, label = "found") => (ok ? h("span", { class: "pill ok" }, label) : h("span", { class: "pill" }, "not found"));
    const plural = (n, w) => `${fmt.n(n)} ${w}${n === 1 ? "" : "s"}`;
    const mnPath = h("input", { type: "text", class: "mono", value: cands[0] || "", placeholder: "path to mnemosyne.db (a Hermes agent keeps it under ~/.hermes/mnemosyne/, also inside WSL)" });
    const replaceCb = h("input", { type: "checkbox" });
    box.replaceChildren(...[
      source("Claude Code", found(cc.exists), "Every chat started in Claude Code's own terminal, per project, from its JSONL files. Each becomes an archived session.",
        cc.root ? h("code", { class: "mem-path small", title: cc.root }, cc.root) : null, h("div", { class: "small" }, cc.exists ? `${plural(cc.sessions || 0, "session")} in ${plural(cc.projects || 0, "project")} · ${plural(cc.files || 0, "file")}` : "Nothing at that path."),
        h("button", { class: "primary sm", disabled: cc.exists ? null : "", onclick: () => start({ source: "claude-code", root: cc.root }, "Importing Claude Code sessions…") }, "Import")),
      source("Mnemosyne database (Hermes)", found(cands.length, cands.length === 1 ? "found" : `${fmt.n(cands.length)} found`), "Memories a Hermes agent, or any other Mnemosyne, already holds. They are merged into Filament's engine database and re-embedded; the engine stops for the copy.",
        h("label", { style: "margin-top:4px" }, "database file ", mnPath),
        cands.length > 1 ? h("div", { class: "small muted" }, "Also found: ", ...cands.slice(1).flatMap((p, i) => [i ? " · " : "", h("a", { href: "#", title: "Use this file", onclick: (e) => { e.preventDefault(); mnPath.value = p; } }, p)])) : null,
        h("label", { class: "check", style: "margin-top:4px" }, replaceCb, "replace the existing engine database instead of merging into it"),
        h("p", { class: "warn small", style: "margin:2px 0 0" }, "Replace deletes everything Filament's engine has learned so far (memories, canonical facts, knowledge graph) and puts the imported database in its place. The archive is untouched either way. Take a backup first."),
        h("button", { class: "primary sm", onclick: () => { const srcFile = mnPath.value.trim(); if (!srcFile) return toast("Enter the path to the database file", "err"); if (replaceCb.checked && !confirm("Replace the engine database with the imported one? Everything Filament's engine learned so far is deleted.")) return; start({ source: "mnemosyne", srcFile, replace: replaceCb.checked }, "Importing the Mnemosyne database…"); } }, "Import")),
      h("label", { class: "check", style: "margin-top:10px" }, learnCb, "after importing sessions, learn titles, end states and facts from them (memory's model; its calls show in Usage)"),
      ((lw) => (lw.model ? null : h("p", { class: "warn small", style: "margin:4px 0 0" }, `Nothing is learned from imported sessions: ${lw.why}. They are imported and searchable all the same.`)))(learnsWith(st.models)),
      jobs].filter((x) => x != null));
  }).catch((e) => box.replaceChildren(h("p", { class: "err small" }, e.message)));
  return box;
}
// "Learn from imported sessions now": POST /memory/backfill, shown with the job panel.
function memBackfillControl(st) {
  const jobs = h("div", {});
  for (const j of (st?.jobs || []).filter((j) => j.status === "running" && j.kind === "learn-backfill")) jobs.append(memJobPanel(j, () => { state.memStatus = null; }));
  const btn = h("button", { disabled: jobs.childElementCount ? "" : null, onclick: async () => { btn.disabled = true; try { const { job } = await api("/memory/backfill", { method: "POST", body: { limit: 200 } }); jobs.append(memJobPanel(job, () => { btn.disabled = false; state.memStatus = null; })); toast("Learning from archived sessions…"); } catch (e) { btn.disabled = false; toast(e.message, "err"); } } }, "Learn from imported sessions now");
  return h("div", {}, h("div", { class: "row", style: "margin:12px 0 0;align-items:center;gap:10px" }, btn, h("span", { class: "muted small" }, "Titles, end states and learned facts for archived sessions that were never learned from, newest first, 200 per run. Uses the cheap model; its calls appear in Usage.")), jobs);
}
// Recall results as rows: kind, date, text, score, session link, Forget.
function memResultsTable(results) {
  const canForget = (m) => m.id != null && !/^(chain|canon):/.test(String(m.id));
  return h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["kind", "when", "memory", "score", "session", ""].map((t) => h("th", {}, t)))), h("tbody", {}, ...results.map((m) => {
    const tr = h("tr", {}, h("td", {}, memKindPill(m.kind)), h("td", { class: "muted small", style: "white-space:nowrap" }, m.when || "–"), h("td", { class: "mem-text" }, String(m.text ?? "")), h("td", { class: "num", title: "relevance, 0 to 1" }, m.score != null ? Number(m.score).toFixed(2) : "–"), h("td", {}, m.chainId ? memSessionLink(m.chainId) : h("span", { class: "muted" }, "–")),
      h("td", { class: "acts" }, canForget(m) ? h("button", { class: "sm ghost danger", title: `Forget ${m.id}`, onclick: async (e) => { if (!confirm("Forget this memory? It is removed from the engine; a learned item is dismissed instead.")) return; e.target.disabled = true; try { const r = await api("/memory/forget", { method: "POST", body: { id: m.id } }); if (r && r.ok === false) throw new Error(r.error || "could not forget"); tr.remove(); toast("Forgotten"); } catch (err) { e.target.disabled = false; toast(err.message, "err"); } } }, "Forget") : null));
    return tr;
  }))));
}
// Readable summary of an engine result (sleep, hygiene, diagnose): scalar fields as key/value, string lists as
// bullets, everything else in a collapsed JSON block.
function memSummary(v) {
  if (v == null) return h("p", { class: "muted small" }, "No details were returned.");
  if (typeof v !== "object") return h("p", { class: "small" }, String(v));
  const rows = [], lists = [];
  for (const [k, val] of Object.entries(v)) {
    if (val == null || ["string", "number", "boolean"].includes(typeof val)) rows.push([k, String(val)]);
    else if (Array.isArray(val) && val.every((x) => typeof x !== "object")) { if (val.length) lists.push([k, val.map(String)]); else rows.push([k, "none"]); }
    else if (Array.isArray(val)) rows.push([k, `${val.length} entr${val.length === 1 ? "y" : "ies"}, see the full result`]);
    else for (const [k2, v2] of Object.entries(val)) if (v2 == null || typeof v2 !== "object") rows.push([`${k}.${k2}`, String(v2)]);
  }
  return h("div", {},
    rows.length ? h("div", { class: "kv small" }, ...rows.slice(0, 30).flatMap(([k, val]) => [h("span", {}, k), h("span", { class: "mem-text" }, val)])) : null,
    ...lists.map(([k, arr]) => h("div", { class: "small" }, h("b", {}, k), h("ul", {}, ...arr.slice(0, 25).map((x) => h("li", { class: "mem-text" }, x))))),
    h("details", { class: "small" }, h("summary", {}, "Full result (JSON)"), h("pre", { class: "small mem-render" }, JSON.stringify(v, null, 2))));
}
// "What the model knew" on a request record: counts and ids from rec.memory plus the memory: change notes.
// Docs → Commands: rendered from /api/commands so the words match THIS configuration (a custom
// memory prefix), unlike the generated docs/COMMANDS.md which can only know the defaults.
function commandsDoc(wanted, toc = null) {
  const box = h("div", { class: "doc commands-doc" }, h("span", { class: "muted small" }, "loading…"));
  const WHERE = { api: ["API-model chats", "a chat whose route points at a provider (Anthropic, OpenAI, a compatible server)"], agent: ["agent chats", "a chat whose route points at a coding agent through Filament's bridge"] };
  api("/commands").then((cat) => {
    const w = cat.words || {};
    box.replaceChildren(
      h("h1", {}, "Commands you can type into a chat"),
      h("p", { class: "small" }, `Filament answers the commands here itself, most with no model, no agent and no tokens, the reply marked local on the Traffic page; a row says where one calls a model or an agent. /resume and /flow give the agent a turn to run, and the harness's own box answers /compaction, /craft and /rewind: nothing goes to the model or agent until you choose. Memory's, unless switched off, are answered in every chat memory does not leave out, memory on or off, and /goal in every chat; the rest in a chat Filament runs, the harness's — in an outside client's chat they go to its model or its coding agent as typed. Memory's commands begin with the word this configuration uses (`, h("code", {}, w.mem), `); change it under Memory → Settings.`),
      h("div", { class: "legend", style: "margin:6px 0 14px" }, ...Object.entries(WHERE).map(([k, [label, tip]]) => h("span", { title: tip }, h("span", { class: "pill" }, k), ` ${label}`))),
      ...cat.groups.map((g) => h("section", { id: `docs-cmd-${g.id}` },
        h("h2", {}, g.title, g.enabled === false ? h("span", { class: "pill warn", style: "margin-left:8px" }, "switched off") : null),
        h("p", { class: "small", html: md(g.intro) }),
        h("div", { class: "table-wrap" }, h("table", { class: "small cmd-table" },
          h("thead", {}, h("tr", {}, h("th", {}, "command"), h("th", {}, "forms"), h("th", {}, "where"), h("th", {}, "what happens"))),
          h("tbody", {}, ...g.commands.map((c) => h("tr", {},
            h("td", {}, h("code", {}, c.command)),
            h("td", {}, ...c.forms.flatMap((f, i) => [i ? h("br") : null, h("code", { class: "small" }, f)])),
            h("td", {}, ...c.where.map((x) => h("span", { class: "pill", title: WHERE[x]?.[1] || "", style: "margin:0 4px 2px 0" }, x))),
            h("td", { class: "small", html: md(c.summary) })))))))));
    toc?.replaceChildren(...cat.groups.map((g) => h("a", { href: `#docs:cmd-${g.id}`, "data-target": `docs-cmd-${g.id}`, onclick: (e) => { e.preventDefault(); document.getElementById(`docs-cmd-${g.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); history.replaceState(null, "", `#docs:cmd-${g.id}`); } }, g.title)));
    if (wanted) { const el = document.getElementById(`docs-${wanted}`); if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 30); }
  }).catch((e) => box.replaceChildren(empty("Commands not available", e.message)));
  return box;
}

function memKnewCard(d) {
  const m = d.memory || {}; const notes = (d.changes || []).filter((x) => /^memory:/i.test(String(x)));
  const row = (k, v) => (v == null || v === "" ? [] : [h("span", {}, k), v.nodeType ? v : h("span", {}, String(v))]);
  const tools = m.tools === true ? "yes, the filament_memory_* tools" : typeof m.tools === "number" ? (m.tools ? `${m.tools} tools` : "no") : m.tools === false ? "no" : null;
  return h("div", { class: "card mem-knew" }, h("h4", {}, "What the model knew"),
    m.command ? h("p", { class: "small", style: "margin:0 0 6px" }, "This message was a memory command: Filament answered it and the upstream was not called.") : null,
    h("div", { class: "kv small" },
      ...row("session", m.chain ? (m.command ? h("code", { title: "chain key; a command record carries no session id" }, String(m.chain)) : memSessionLink(m.chain)) : null), ...row("turn", m.turn != null ? (m.turnId ? `${m.turn} (archive row ${m.turnId})` : m.turn) : null), ...row("position", m.position), ...row("client", m.client), ...row("signals", m.signals?.length ? m.signals.join(", ") : m.signals ? "none" : null),
      ...row("briefing items", m.briefing != null ? fmt.n(m.briefing) : null), ...row("attached this turn", m.injected != null ? fmt.n(m.injected) : null), ...row("memory tokens", m.tokens != null ? `~${fmt.n(m.tokens)}` : null),
      ...row("tools offered", tools), ...row("tool rounds", m.toolRounds != null ? `${fmt.n(m.toolRounds)} round${m.toolRounds === 1 ? "" : "s"} · ${fmt.n(m.toolCalls || 0)} call${m.toolCalls === 1 ? "" : "s"}` : null),
      ...row("loaded session", m.loaded ? memSessionLink(m.loaded) : null), ...row("muted", m.muted ? "yes, this chat asked memory to stay out" : null),
      ...row("ids", m.ids?.length ? `${fmt.n(m.ids.length)} item id${m.ids.length === 1 ? "" : "s"} (content is never stored on the record)` : null)),
    m.ids?.length ? (() => { // resolve the ids to their text on demand, exactly like the Activity tab does
      const list = h("ul", { class: "small mem-itemlist", style: "display:none" });
      const btn = h("button", { class: "sm ghost", title: "Fetch the items themselves from the archive (the record only keeps ids)", onclick: async () => {
        if (list.style.display === "none") { list.style.display = ""; if (!list.childElementCount) { list.append(h("li", { class: "muted small" }, "resolving…")); try { const { items } = await api("/memory/injection-items", { method: "POST", body: { ids: m.ids } }); list.replaceChildren(...items.map((it) => h("li", {}, memKindPill(it.kind), " ", it.text ? h("span", {}, String(it.text).slice(0, 240)) : h("span", { class: "muted" }, `(${it.id})`), it.chainId ? h("span", {}, " · from ", memSessionLink(it.chainId)) : null))); } catch (e) { list.replaceChildren(h("li", { class: "err small" }, e.message)); } } }
        else list.style.display = "none";
      } }, `what were these ${m.ids.length} item${m.ids.length === 1 ? "" : "s"}?`);
      return h("div", { style: "margin:6px 0 0" }, btn, list);
    })() : null,
    notes.length ? h("ul", { class: "small", style: "margin:8px 0 0" }, ...notes.map((n) => h("li", {}, n))) : h("p", { class: "muted small", style: "margin:8px 0 0" }, "No memory notes on this request."));
}
// The memory timeline of one request: what the memory layer did, in order, with the time each step took. Content
// never appears here; the steps carry counts, ids, scores and reasons (see src/services/memory/trace.js).
const TL_PHASES = { before: "Before the upstream was called (this delays the reply)", upstream: "While the upstream answered", after: "After the client had its reply (off the critical path)", later: "Later, in the background" };
const tlMs = (v) => (v == null ? "–" : v < 1 ? `${Math.round(v * 10) / 10} ms` : v < 1000 ? `${Math.round(v * 10) / 10} ms` : `${(v / 1000).toFixed(2)} s`);
const tlLabel = (k) => k.replace(/([A-Z])/g, " $1").toLowerCase();
function memTimelineCard(d) {
  const t = d.memoryTrace; if (!t) return null; const s = t.summary || {}; const m = d.memory || {};
  const total = d.totalMs || 0; const handed = t.marks?.handed ?? (s.blockingMs || 0); const first = t.marks?.firstByte ?? d.ttftMs ?? handed;
  const before = Math.max(0, Math.min(total, handed)); const wait = Math.max(0, first - handed); const after = Math.min(s.afterMs || 0, Math.max(0, total - first)); const reply = Math.max(0, total - first - after);
  const seg = (cls, v, label) => (v > 0 && total ? h("i", { class: cls, style: `width:${Math.max(0.4, (v / total) * 100)}%`, title: `${label}: ${tlMs(v)}` }) : null);
  const pctOf = (v) => (total && v != null ? `${Math.round((v / total) * 1000) / 10}%` : "–");
  const stayedOut = !d.memory ? (t.steps || []).find((x) => x.name === "memory stays out")?.why : null;
  const chip = (k, v, cls = "") => h("div", { class: `tl-stat ${cls}` }, h("span", { class: "muted small" }, k), h("b", {}, v));
  const stats = m.command ? [chip("answered by", "Filament (memory command)"), chip("took", tlMs(s.blockingMs))]
    : stayedOut ? [chip("memory", "stayed out"), chip("why", stayedOut)]
    : [chip("before the call", `${tlMs(s.blockingMs)} · ${pctOf(s.blockingMs)} of ${fmt.ms(total)}`, s.blockingMs > 300 ? "warn" : ""),
      chip("engine", s.engineCalls ? `${s.engineCalls} call${s.engineCalls === 1 ? "" : "s"} · ${tlMs(s.engineMs)}${s.engineErrors ? ` · ${s.engineErrors} failed` : ""}` : "not asked", s.engineErrors ? "err" : ""),
      chip("tokens added", m.tokens ? `~${fmt.n(m.tokens)}` : "none"),
      chip("tool rounds", s.toolRounds ? `${s.toolRounds} · ${tlMs(s.toolMs)} in memory` : "none"),
      chip("after the reply", `${tlMs(s.afterMs)} · off the critical path`),
      chip("model calls by memory", "none in this request; learning runs later")];
  const order = { before: 0, upstream: 1, after: 2, later: 3 };
  const steps = [...(t.steps || [])].map((x, i) => ({ ...x, i })).sort((a, b) => (order[a.phase] ?? 9) - (order[b.phase] ?? 9) || a.i - b.i);
  const rows = []; let phase = null;
  for (const x of steps) {
    if (x.phase !== phase) { phase = x.phase; rows.push(h("tr", { class: "tl-phase" }, h("td", { colspan: 4 }, TL_PHASES[phase] || phase))); }
    const { at, ms, name, depth, kind, ok, error, note, async: isAsync, i, phase: ph, ...rest } = x;
    const kv = Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => h("span", { class: "tl-kv" }, h("b", {}, tlLabel(k)), " ", typeof v === "boolean" ? (v ? "yes" : "no") : String(v)));
    rows.push(h("tr", { class: `tl-step d${Math.min(depth || 0, 3)}${error ? " bad" : ""}` },
      h("td", { class: "num mono muted small", title: at < 0 ? "just before the request record started" : `${tlMs(at)} after the request came in` }, at < 0 ? "0" : tlMs(at).replace(" ms", "")),
      h("td", { class: "tl-name", style: `padding-left:${8 + Math.min(depth || 0, 3) * 16}px` }, kind === "engine" ? h("span", { class: `pill ${ok === false ? "err" : ""}`, title: "a call to the Mnemosyne engine (child process)" }, "engine") : null, kind === "engine" ? " " : null, h("span", {}, kind === "engine" ? name.replace(/^engine /, "") : name), isAsync ? h("span", { class: "muted small" }, " · background") : null, rest.started ? h("span", { class: "pill warn", title: "the engine had to start first" }, "cold start") : null),
      h("td", { class: "num mono small" }, ms != null ? tlMs(ms) : ""),
      h("td", { class: "tl-details small" }, ...kv, error ? h("div", { class: "err small" }, error) : null, note ? h("div", { class: "muted small" }, note) : null)));
  }
  return h("div", { class: "card mem-tl" }, h("h4", {}, "Memory timeline"),
    h("p", { class: "muted small", style: "margin:0 0 8px" }, m.command ? "This message was a memory command; Filament answered it and no upstream was called." : stayedOut ? "Memory did nothing for this request." : "Every step the memory layer took for this request, in order, with the time it cost. Only the first group delays the reply; the rest happens while the upstream answers or after the client has its answer."),
    total && !m.command && !stayedOut ? h("div", {}, h("div", { class: "timing" }, seg("mem-before", before, "memory before the call"), seg("wait", wait, "waiting for the upstream's first byte"), seg("stream", reply, "receiving the reply"), seg("mem-after", after, "memory after the reply")), h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--warn)" }), ` memory before ${tlMs(before)}`), h("span", {}, h("i", { class: "wait-swatch" }), ` upstream wait ${tlMs(wait)}`), h("span", {}, h("i", { class: "stream-swatch" }), ` reply ${tlMs(reply)}`), h("span", {}, h("i", { style: "background:var(--ok)" }), ` memory after ${tlMs(after)}`))) : null,
    h("div", { class: "tl-stats" }, ...stats),
    h("details", { class: "tl-detail", open: steps.length <= 12 ? "" : null }, h("summary", { class: "small" }, `${steps.length} step${steps.length === 1 ? "" : "s"}${t.summary?.dropped ? ` (+${t.summary.dropped} not kept)` : ""} · click for the full list`),
      h("div", { class: "table-wrap" }, h("table", { class: "small tl-table" }, h("thead", {}, h("tr", {}, h("th", { title: "when the step happened, counted from the moment the request came in" }, "at"), h("th", {}, "step"), h("th", {}, "took"), h("th", {}, "details"))), h("tbody", {}, ...rows)))));
}
// The benchmark panels above the injection log: memory's cost per request, memory's own model calls, learning runs.
function memBenchmarkPanels() {
  const box = h("div", {}, h("section", { class: "panel" }, h("span", { class: "muted small" }, "loading the benchmark…")));
  const stat = (k, v, hint) => h("div", { class: "tl-stat", title: hint || "" }, h("span", { class: "muted small" }, k), h("b", {}, v));
  const load = () => api("/memory/benchmark?limit=100").then((b) => {
    const st = b.stats || {}; const rows = b.rows || []; const calls = b.modelCalls || []; const learn = b.learning;
    const link = (id) => h("a", { href: "#requests", class: "golink mono small", title: "Open this request", onclick: (e) => { e.preventDefault(); openRequest(id).catch((err) => toast(err.message, "err")); } }, String(id));
    const usedPill = (u) => (u === true ? h("span", { class: "pill ok" }, "yes") : u === false ? h("span", { class: "pill warn" }, "no") : h("span", { class: "pill" }, "–"));
    const cost = h("section", { class: "panel" },
      h("div", { class: "row", style: "margin:0 0 6px;align-items:center" }, h("h2", { style: "margin:0" }, "Memory cost per request"), h("span", { class: "grow" }), h("button", { class: "sm", onclick: load }, "Refresh")),
      h("p", { class: "muted small", style: "margin:0 0 10px" }, "For every request that passed through with memory on, how long the memory layer held the request before the upstream was called, what the engine cost, how much was added, and whether the reply used it. Open a request for its full timeline. The lookups run before the upstream call so the model sees memory on the very message it answers; the “before the call” numbers are what running them in parallel would win back."),
      st.withMemory ? h("div", { class: "tl-stats" },
        stat("requests", `${fmt.n(st.withMemory)} with memory · ${fmt.n(st.requests - st.withMemory)} without`),
        stat("before the call, median", tlMs(st.blockingP50), "half of the requests waited at most this long for memory"), stat("95th percentile", tlMs(st.blockingP95), "19 of 20 requests waited at most this long"), stat("worst", tlMs(st.blockingMax)),
        stat("share of total time", st.shareOfTotal != null ? `${st.shareOfTotal}%` : "–", "memory's blocking time over the requests' total time"),
        stat("engine", `${fmt.n(st.engineCalls)} calls · ${tlMs(st.enginePerCallMs)} each${st.engineErrors ? ` · ${st.engineErrors} failed` : ""}`),
        stat("tokens added, average", st.tokensAvg ? `~${fmt.n(st.tokensAvg)}` : "0"),
        stat("tool rounds", st.toolRounds ? `${fmt.n(st.toolRounds)} · ${tlMs(st.toolMs)} in memory` : "none"),
        stat("replies that used it", st.usedRate != null ? `${st.usedRate}% of ${fmt.n(st.judged)} judged` : "not judged yet")) : h("p", { class: "muted small" }, "No request with memory has been traced yet. Traces start with the first request after this update."),
      rows.length ? h("div", { class: "table-wrap", style: "margin-top:10px" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["when", "request", "client", "model", "position", "before the call", "engine", "tokens", "tool rounds", "after", "total", "used"].map((x) => h("th", {}, x)))), h("tbody", {}, ...rows.map((r) => h("tr", {},
        h("td", { class: "muted small", style: "white-space:nowrap", title: memWhen(r.ts) }, memAgo(r.ts)), h("td", {}, link(r.id)), h("td", { class: "small" }, r.client || "–"), h("td", {}, h("code", {}, r.model || "–")),
        ...(r.command ? [h("td", { colspan: 7, class: "muted small" }, `memory command answered by Filament in ${tlMs(r.blockingMs ?? r.totalMs)}`)] : r.stayedOut ? [h("td", { colspan: 7, class: "muted small" }, `stayed out: ${r.stayedOut}`)] : [
          h("td", { class: "small" }, r.position || "–"), h("td", { class: `num ${r.blockingMs > 300 ? "warn" : ""}` }, tlMs(r.blockingMs)), h("td", { class: "num small" }, r.engineCalls ? `${r.engineCalls} · ${tlMs(r.engineMs)}${r.engineErrors ? ` · ${r.engineErrors} failed` : ""}` : "–"), h("td", { class: "num" }, r.tokens ? `~${fmt.n(r.tokens)}` : "–"), h("td", { class: "num small" }, r.toolRounds ? `${r.toolRounds} · ${tlMs(r.toolMs)}` : "–"), h("td", { class: "num small" }, tlMs(r.afterMs)), h("td", { class: "num small" }, fmt.ms(r.totalMs)), h("td", {}, usedPill(r.used))])))))) : null);
    const runs = learn?.runs || [];
    const learning = h("section", { class: "panel" }, h("h2", { style: "margin:0 0 6px" }, "Learning runs"),
      h("p", { class: "muted small", style: "margin:0 0 10px" }, learn ? `Each run reads a session's new turns with the cheap model (${learn.model || "none reachable"}) and extracts a title, an end state and durable items. Runs start once a session has been idle for ${learn.idleMinutes} minutes, at a compaction, or from the Sessions page. ${fmt.n(learn.stats?.pending || 0)} session${(learn.stats?.pending || 0) === 1 ? "" : "s"} waiting; ${fmt.n(learn.stats?.runs || 0)} run${(learn.stats?.runs || 0) === 1 ? "" : "s"} and ${fmt.n(learn.stats?.items || 0)} item${(learn.stats?.items || 0) === 1 ? "" : "s"} since start${learn.stats?.lastError ? `; last error: ${learn.stats.lastError}` : ""}.` : "Memory is off."),
      runs.length ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["when", "session", "reason", "model calls", "items", "deduped", "took", "result"].map((x) => h("th", {}, x)))), h("tbody", {}, ...runs.map((r) => h("tr", {},
        h("td", { class: "muted small", style: "white-space:nowrap", title: memWhen(r.at) }, memAgo(r.at)), h("td", {}, memSessionLink(r.chain)), h("td", { class: "small" }, r.reason || "–"), h("td", { class: "num" }, fmt.n(r.modelCalls || 0)), h("td", { class: "num" }, r.items != null ? fmt.n(r.items) : "–"), h("td", { class: "num" }, r.dedupedItems != null ? fmt.n(r.dedupedItems) : "–"), h("td", { class: "num" }, fmt.ms(Math.round(r.ms || 0))),
        h("td", {}, r.error ? h("span", { class: "pill err", title: r.error }, "failed") : r.skipped ? h("span", { class: "pill", title: `skipped: ${r.skipped}` }, `skipped · ${r.skipped}`) : h("span", { class: "pill ok" }, `learned${r.title ? " · title" : ""}${r.state ? " · state" : ""}`))))))) : h("p", { class: "muted small" }, "No run since Filament started."));
    box.replaceChildren(cost, learning, h("p", { class: "muted small", style: "margin:0 0 14px" }, `Memory's own model calls (${fmt.n(calls.length)} recent) are in `, h("a", { href: "#requests", onclick: (e) => { e.preventDefault(); setReqFilter({ tab: "memory" }); go("requests"); } }, "Traffic → Memory"), " with their tokens and cost; the per-day and per-model aggregates stay on ", goto("memusage", "Memory → LLM usage"), ". Usage counts your clients' traffic unless its scope toggle says otherwise."));
  }).catch((e) => box.replaceChildren(h("section", { class: "panel" }, h("p", { class: "err small" }, e.message))));
  load(); return box;
}
function input(obj, key, placeholder) { const i = h("input", { type: "text", value: obj[key] ?? "", placeholder }); i.onchange = () => { obj[key] = i.value; markDirty(); }; return i; }
// An upstream's id is referenced by routes and fallbacks: renaming it here remaps every reference (and keeps the card selected), like removal does.
// An upstream renamed keeps the id it was read under (`renamedFrom`): Save finds the secrets kept under that id there
// and carries them to the new one (mergeSecrets).
function idInput(u) { const i = h("input", { type: "text", value: u.id ?? "", placeholder: "short-id", class: "mono" }); i.onchange = () => { const from = u.id, to = i.value.trim(); if (!to || to === from) { i.value = from; return; } const c = state.config; for (const r of c.routes || []) { if (r.upstream === from) r.upstream = to; for (const f of r.fallbacks || []) if (f.upstream === from) f.upstream = to; } if (state.selUp === from) state.selUp = to; u.renamedFrom ??= from; u.id = to; markDirty(); }; return i; }
function mergedRules(...layers) { return mergeRuleLayers(state.schema.rules, ...layers); }
// The result of pinging a model name: a pill with timing, tokens and cost, or the failure.
const pingResult = (r) => r.ok ? h("span", { class: "pill ok", title: `${r.upstream || ""} / ${r.upstreamModel || ""}${r.text ? ` · said “${r.text}”` : ""}${r.changes?.length ? ` · ${r.changes.length} rule change(s)` : ""}` }, `${fmt.ms(r.ms)}${r.tokens ? ` · ${fmt.n((r.tokens.input || 0) + (r.tokens.cacheRead || 0))} in / ${fmt.n(r.tokens.output)} out` : ""}${r.cost ? ` · ${fmt.usd(r.cost)}` : ""}`) : h("span", { class: "pill err", title: r.error || "" }, `failed${r.status ? ` (${r.status})` : ""}: ${fmt.errorGist(r.error).slice(0, 120)}`);

// ---- live view of what is in flight// ---- live view of what is in flight: a one-second ticker while anything is pending or streaming ----
// Pending rows show how long they have waited; in-flight rows show the speed over the last second (big number and a
// sparkline of the last half minute), the average since the first byte, tokens so far and what the agent is doing.
const LIVE_HIST = new Map(); // request id -> last 30 one-second speeds
const liveHist = (r) => { const hist = LIVE_HIST.get(r.id) || []; if (phaseOf(r) === "streaming") { hist.push(r.liveTpsNow || 0); while (hist.length > 30) hist.shift(); LIVE_HIST.set(r.id, hist); } return hist; };
// One row per turn (HarnessV3-Responsiveness R6): `/api/live` places each request under the turn it belongs to
// (`parentId`) and says what a turn is doing right now (`now`). A turn and its model call used to be two unrelated
// rows, and between calls the turn's row alone read "waiting" for minutes; now the call folds into its turn's row and
// a sub-agent's turn sits beneath the turn that launched it.
const TURN_SOURCES = new Set(["agent-loop", "subagent"]);
const isTurnRow = (r) => TURN_SOURCES.has(r.source);
function nowText(n) {
  if (!n) return "";
  const f = n.forMs != null ? ` · ${fmt.ms(n.forMs)}` : "";
  if (n.what === "model") return `calling ${n.model || "the model"}${f}`;
  if (n.what === "tool") return `running ${n.name}${n.args ? ` ${String(n.args).slice(0, 90)}` : ""}${f}`;
  if (n.what === "waiting") return `${n.why || "waiting"}${f}`; // the loop says it in words: "waiting for sub-agents to report"
  return `working${n.forMs != null ? ` · ${fmt.ms(n.forMs)} since its last step` : ""}`;
}
// The in-flight rows depth-first, each under its parent, with the model call each turn's `now` names folded into it
// (`call`; `fold: false` keeps it a row of its own too). A row whose parent is not in the list stands at the top.
function liveTree(active, { fold = true } = {}) {
  const rows = active || [], ids = new Set(rows.map((r) => r.id)), seen = new Set(), out = [];
  const callOf = (r) => (isTurnRow(r) && r.now ? rows.find((c) => c.parentId === r.id && !isTurnRow(c)) || null : null);
  const walk = (r, depth) => {
    if (seen.has(r.id)) return; seen.add(r.id);
    const call = callOf(r); if (call && fold) seen.add(call.id);
    out.push({ r, depth, call });
    for (const c of rows) if (c.parentId === r.id) walk(c, depth + 1);
  };
  for (const r of rows) if (!r.parentId || !ids.has(r.parentId)) walk(r, 0);
  return out;
}
function liveRow(r, { depth = 0, call = null } = {}) {
  const indent = depth ? { style: `margin-left:${depth * 22}px` } : {};
  if (isTurnRow(r) && r.now) {
    const hist = call ? liveHist(call) : [];
    const talking = call && phaseOf(call) === "streaming";
    return h("div", { class: `live-row ${talking ? "streaming" : "pending"}`, ...indent },
      h("div", { class: "meta" }, h("span", { class: "pulse" }), h("code", {}, r.model), r.source === "subagent" ? h("span", { class: "pill", title: "a sub-agent's turn" }, "sub-agent") : null, h("span", { class: "muted small" }, `turn · running for ${fmt.ms(r.elapsedMs)}`),
        h("div", { class: "small now-line" }, `now: ${nowText(r.now)}`)),
      h("div", { class: "tps" }, talking
        ? h("div", {}, h("div", { class: "now", title: "the model's output tokens per second over the last second" }, call.liveTpsNow != null ? String(call.liveTpsNow) : "–", h("small", {}, "tok/s now")), spark(hist))
        : h("div", {}, h("div", { class: "now wait", title: "how long the turn has been at what it is doing now" }, r.now.forMs != null ? fmt.ms(r.now.forMs) : "–", h("small", {}, r.now.what)))));
  }
  const streaming = phaseOf(r) === "streaming";
  const hist = liveHist(r);
  const agent = /^(acp|sdk):\/\//.test(r.url || "");
  const detail = !streaming
    ? `sent ${fmt.ms(r.elapsedMs)} ago · no reply yet${agent ? " (the agent is working; the first bytes arrive when it starts to talk)" : ""}`
    : `first byte after ${fmt.ms(r.waitMs)} · in flight for ${fmt.ms(r.streamMs)} · ~${fmt.n(r.liveOutTokens)} tokens out${r.liveThinkTokens ? ` (~${fmt.n(r.liveThinkTokens)} thinking)` : ""}${r.liveTps != null ? ` · ${r.liveTps} tok/s average` : ""}${r.stage ? ` · ${r.stage}` : ""}`;
  const pause = streaming && r.stalled ? h("div", { class: "small warn-text" }, `quiet for ${fmt.ms(r.sinceOutputMs)}: ${agent ? "the agent is thinking or running a tool" : "the model is thinking or the provider paused"}`) : null;
  return h("div", { class: `live-row ${streaming ? (r.stalled ? "stalled" : "streaming") : "pending"}`, ...indent },
    h("div", { class: "meta" }, h("span", { class: "pulse" }), h("code", {}, r.model), h("span", { class: "muted" }, r.upstream ? `→ ${upstreamWords(r.upstream) || r.upstream}` : "routing…"), statusPill(r), h("span", { class: "muted small" }, detail), pause),
    h("div", { class: "tps" }, streaming
      ? h("div", {}, h("div", { class: "now", title: "output tokens per second over the last second" }, r.liveTpsNow != null ? String(r.liveTpsNow) : "–", h("small", {}, "tok/s now")), spark(hist))
      : h("div", {}, h("div", { class: "now wait", title: "time since the request was sent on" }, fmt.ms(r.elapsedMs), h("small", {}, "waiting")))));
}
let liveTimer = null, liveIdleTicks = 0;
async function liveTick() {
  let live; try { live = await api("/live"); } catch { return; }
  const rows = live.active || [];
  for (const id of [...LIVE_HIST.keys()]) if (!rows.some((r) => r.id === id)) LIVE_HIST.delete(id);
  liveIdleTicks = rows.length ? 0 : liveIdleTicks + 1;
  if (liveIdleTicks > 3) { stopLiveTicker(); return; } // idle-out and history pruning happen even with "live" off, or the ticker never stops
  if (!state.live) return;
  if (state.tab === "overview" && state.homePane === "status" && state._liveDraw) state._liveDraw(live);
  if (state.tab === "requests") applyLiveToTable(live);
}
function startLiveTicker() { liveIdleTicks = 0; if (!liveTimer) liveTimer = setInterval(liveTick, 1000); }
function stopLiveTicker() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }
// The Requests table: update the unfinished rows in place (state pill, wait, elapsed, speed) without a full repaint.
// A running row says what has streamed so far and how long since its newest byte, and reads quiet once none has
// come for a while (`liveCells`; HarnessV4_Tasks U1): a stuck call and a working one read apart.
function applyLiveToTable(live) {
  const byId = new Map((live.active || []).map((r) => [r.id, r]));
  for (const tr of document.querySelectorAll("table.requests tr[data-id]")) {
    const r = byId.get(tr.dataset.id); if (!r) continue;
    const streaming = phaseOf(r) === "streaming";
    const cells = liveCells(r);
    tr.querySelector(".c-status")?.replaceChildren(...[statusPill(r), cells.quiet ? h("span", { class: "pill warn", title: QUIET_WORDS }, cells.quiet) : null, failoverPill(r), memPill(r), sourcePill(r), r.replayOf ? h("span", { class: "pill", title: `a replay of request ${r.replayOf}` }, "↻") : null, r.status === "pending" ? stopReqBtn(r.id) : null].filter(Boolean)); // replaceChildren prints null args as text; h() filters them
    const ttft = tr.querySelector(".c-ttft"); if (ttft) ttft.textContent = streaming ? fmt.ms(r.waitMs) : `waiting ${fmt.ms(r.elapsedMs)}`;
    const tot = tr.querySelector(".c-total"); if (tot) { tot.textContent = fmt.ms(r.elapsedMs); tot.title = cells.lastByte; }
    const out = tr.querySelector(".c-out"); if (out) { out.textContent = cells.out; out.title = cells.outTitle; }
    const think = tr.querySelector(".c-think"); if (think) think.textContent = cells.think;
    const tps = tr.querySelector(".c-tps"); if (tps) { tps.textContent = streaming ? `${r.liveTpsNow ?? 0} now` : "…"; tps.title = streaming ? `${r.liveTps ?? "–"} tok/s average since the first byte` : "no reply yet"; }
  }
}

// The requests table, newest first. Options: `dividers` puts a row between days; `group` folds consecutive requests
// of one conversation (same client session id) into a summary row that opens on click, so a long agent session reads
// as one story instead of forty rows. Unfinished rows carry data-id and cell classes for the live ticker.
// ---- operations (W9 Phase B): everything Filament did that was not a model call ------------------------------------
// Kind labels and hints come from the schema (`state.schema.opKinds`), the same list the recorder validates against,
// so a kind added server-side appears here with its real name instead of a raw token.
function opKindMeta(k) { return state.schema?.opKinds?.[k] || { label: k, hint: "", noisy: false }; }
function opPill(o) { const m = opKindMeta(o.kind); return h("span", { class: `pill op-${o.kind}${m.noisy ? " noisy" : ""}`, title: m.hint || null }, m.label || o.kind); }
const OP_HEADS = [["when", ""], ["kind", "which subsystem did this"], ["what happened", ""], ["took", ""], ["detail", "ids, counts and decisions — never conversation text"]];
function opDetailCells(o) {
  const det = Object.entries(o.detail || {}).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length));
  return h("td", { class: "small muted" }, ...det.slice(0, 5).map(([k, v]) => h("span", { class: "tl-kv", style: "margin-right:9px" }, h("b", {}, k), " ", Array.isArray(v) ? v.slice(0, 6).join(", ") : String(v).slice(0, 90))));
}
function opRow(o) {
  const rid = o.ref?.requestId;
  return h("tr", { class: rid ? "clickable" : "", title: rid ? `Open request ${rid}` : null, onclick: rid ? () => openRequest(rid) : null },
    h("td", { class: "muted" }, fmt.t(o.ts)),
    h("td", {}, opPill(o), o.sub ? h("span", { class: "muted small", style: "margin-left:6px" }, o.sub) : null),
    h("td", { class: o.level === "error" ? "err" : o.level === "warn" ? "warn" : "" }, o.title || ""),
    h("td", { class: "num muted" }, o.ms != null ? fmt.ms(o.ms) : "–"),
    opDetailCells(o));
}
function opsTable(list) {
  if (!list.length) return empty("No operations recorded", "Health changes and cooldowns, config saves, background jobs, compactions, memory-engine and learner activity all appear here. If this is empty, observability.ops may be off.");
  return h("div", { class: "table-wrap" }, h("table", { class: "ops" },
    h("thead", {}, h("tr", {}, ...OP_HEADS.map(([t, tip]) => h("th", { title: tip || null }, t)))),
    h("tbody", {}, ...list.map(opRow))));
}
// The All tab: requests and operations in one chronological stream, which is the point of the whole workstream. A
// compaction sits next to the request that caused it and the slices it spawned, instead of being spread over three
// pages that had to be matched by timestamp by hand.
function mixedTable(items) {
  if (!items.length) return empty("Nothing has happened yet", "Model calls and Filament's own operations both appear here, newest first.");
  return h("div", { class: "table-wrap" }, h("table", { class: "ops mixed" },
    h("thead", {}, h("tr", {}, ...[["when", ""], ["what", "a model call, or something Filament did"], ["detail", ""], ["status", ""], ["took", ""]].map(([t, tip]) => h("th", { title: tip || null }, t)))),
    h("tbody", {}, ...items.map((it) => it.type === "op" ? opRow(it.op) : h("tr", { class: "clickable", onclick: () => openRequest(it.r.id) },
      h("td", { class: "muted" }, fmt.t(it.r.ts)),
      h("td", {}, h("span", { class: "pill", title: state.schema?.trafficSources?.[it.r.source]?.hint || null }, it.r.source === "client" ? "request" : (state.schema?.trafficSources?.[it.r.source]?.short || it.r.source)), h("code", { style: "margin-left:6px" }, it.r.model)),
      h("td", { class: "muted small" }, it.r.upstream || it.r.local || it.r.memory?.command ? whereWent(it.r) : (it.r.memoryFor?.purpose ? `purpose ${it.r.memoryFor.purpose}` : "answered locally")),
      h("td", {}, statusPill(it.r)),
      h("td", { class: "num muted" }, fmt.ms(it.r.totalMs)))))));
}
/**
 * The raw messages one agent session kept (AC1-7), newest first, each its type, its time and its JSON — opened from the
 * session's row on Home → Agents.
 * @param {any} c  a conversation row of `/acp/status`
 */
function openRawMessages(c) {
  const box = h("div", {}, h("span", { class: "muted small" }, "loading…"));
  openDrawer(`Raw messages · ${String(c.sessionId || c.key).slice(0, 20)}`, box);
  api(`/acp/conversations/${encodeURIComponent(c.key)}/raw`).then((r) => {
    const MAX = 6000;
    const rows = [...(r.raw || [])].reverse().map((/** @type {any} */ m) => {
      const json = JSON.stringify(m.message, null, 2);
      return h("div", { class: "panel", style: "margin-bottom:10px" },
        h("div", { class: "small" }, h("span", { class: "pill" }, m.type), " ", h("span", { class: "muted" }, fmt.t(m.at))),
        h("pre", { class: "small", style: "white-space:pre-wrap;max-height:320px;overflow:auto" }, json.length > MAX ? `${json.slice(0, MAX)}…` : json),
        json.length > MAX ? h("div", { class: "muted small" }, `${fmt.n(json.length - MAX)} more characters not shown`) : null);
    });
    box.replaceChildren(...(rows.length ? rows : [h("span", { class: "muted small" }, "none kept")]));
  }).catch((e) => box.replaceChildren(h("span", { class: "err small" }, String(e?.message || e))));
}

// ---- Agents (W9 Phase D): the live snapshot PLUS history ---------------------------------------------------------
// `/api/acp/status` is a snapshot: processes, conversations, live turns, the last tool hits, the last permissions. It
// has no history at all, so a leak rate or a tool-call count only existed for as long as the ring held it and was
// aggregated nowhere. History comes from the request records — every agent turn finishes as ONE record carrying an
// `acp` block with its tool stats — which is why the aggregate can live here rather than in a new store.
function agentsView(limit = 100) {
  const box = h("div", {}, h("span", { class: "muted small" }, "loading agent status…"));
  const turns = (state.requests || []).filter((r) => r.acp);
  const agg = turns.reduce((a, r) => {
    const t = r.acp.toolStats || {};
    a.turns++; a.calls += t.calls || 0; a.announced += t.announced || 0; a.routed += t.routed || 0; a.builtIn += t.builtIn || 0;
    a.lines += (r.acp.linesAdded || 0) + (r.acp.linesRemoved || 0);
    if (r.status === "error") a.errors++;
    return a;
  }, { turns: 0, calls: 0, announced: 0, routed: 0, builtIn: 0, lines: 0, errors: 0 });
  // Leak rate: the share of tool calls the agent ran with its OWN built-in tools instead of the ones Filament routed to
  // it. 0% means the bridge is doing its job; 100% means Filament's toolset was ignored entirely.
  const leak = agg.calls ? Math.round((100 * agg.builtIn) / agg.calls) : null;
  const card = (label, value, sub, cls) => h("div", { class: "card stat mini-stat" }, h("div", { class: "label" }, label), h("div", { class: `big${cls ? ` ${cls}` : ""}` }, value), sub ? h("div", { class: "sub" }, sub) : null);
  const table = (heads, rows) => (rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...heads.map(([t, tip]) => h("th", { title: tip || null }, t)))), h("tbody", {}, ...rows))) : null);

  api("/acp/status").then((s) => {
    // Rows are built into their own variables and the sections collected into an array, rather than nesting five levels
    // of "cond ? h(section, h2, table(heads, arr.map(tr)))" inside one replaceChildren call. That nesting is where a
    // closing paren goes missing and the entire dashboard file stops parsing — shallow and boring beats clever.
    const sections = [];
    const sec = (title, body) => { if (body) sections.push(h("section", { class: "panel", style: "margin-bottom:18px" }, h("h2", {}, title), body)); };
    const cards = h("div", { class: "grid4", style: "margin-bottom:14px" },
      card("Agent turns", fmt.n(agg.turns), `${agg.errors} failed · from the request records, so this is history, not just the moment`),
      card("Tool calls", fmt.n(agg.calls), `${fmt.n(agg.routed)} through Filament · ${fmt.n(agg.builtIn)} the agent's own`),
      card("Leak rate", leak == null ? "–" : `${leak}%`, leak == null ? "no tool calls recorded yet" : "share run with the agent's OWN tools instead of Filament's — 0% is the bridge working, 100% means it was ignored", leak != null && leak > 50 ? "err" : leak != null && leak > 0 ? "warn" : ""),
      card("Lines touched", fmt.n(agg.lines), "added + removed across those turns"));

    const turnRows = turns.slice(0, Math.max(10, limit)).map((r) => {
      const t = r.acp.toolStats || {};
      const tl = t.calls ? Math.round((100 * (t.builtIn || 0)) / t.calls) : null;
      const cells = [
        h("td", { class: "muted" }, fmt.t(r.ts)),
        h("td", {}, statusPill(r)),
        h("td", {}, h("code", {}, String(r.acp.sessionId || "–").slice(0, 18))),
        h("td", {}, h("span", { class: `pill${r.acp.configuredBridge && r.acp.configuredBridge !== r.acp.bridge ? " warn" : ""}`, title: r.acp.configuredBridge && r.acp.configuredBridge !== r.acp.bridge ? `Configured \`${r.acp.configuredBridge}\`, but the client actually got \`${r.acp.bridge}\` — usually because it declared no tools of its own` : null }, r.acp.bridge || "–")),
        h("td", { class: "num" }, `${fmt.n(t.calls || 0)} / ${fmt.n(t.routed || 0)} / ${fmt.n(t.builtIn || 0)}`),
        h("td", { class: `num${tl == null ? " muted" : tl > 50 ? " err" : tl > 0 ? " warn" : ""}` }, tl == null ? "–" : `${tl}%`),
        h("td", { class: "num muted" }, `${r.acp.linesAdded || 0} / ${r.acp.linesRemoved || 0}`),
        h("td", { class: "muted small" }, r.acp.modelUsage ? JSON.stringify(r.acp.modelUsage).slice(0, 60) : "–"),
      ];
      return h("tr", { class: "clickable", onclick: () => openRequest(r.id) }, ...cells);
    });
    const turnHeads = [["when", ""], ["status", ""], ["agent session", ""], ["bridge", "native = the client's own tools; full = Filament also lends it file and terminal tools; prompts = questions and plans only; off = none"], ["calls", "total / through Filament / its own"], ["leak", "this turn's share of tool calls the agent ran itself"], ["lines", "+added / −removed"], ["model usage", "what the agent reported spending"]];
    sec("Turn history", turns.length ? table(turnHeads, turnRows) : empty("No agent turns in the request ring", "Run a turn through an agent route (claude-code/*, cursor/*, qoder-cn/*) and it appears here with its tool stats."));

    // Agent lifecycle as history. `/api/acp/status` is a snapshot and the turn table above only covers turns still in
    // the request ring; these operations are durable, so "which agent asked for permission an hour ago, and what did
    // Filament decide" finally has an answer. Sessions started and resumed, permission decisions, processes exiting or
    // being killed from the dashboard.
    const agentOps = (state.ops || []).filter((o) => o.kind === "agent");
    if (agentOps.length) sec("Agent activity", table([["when", ""], ["what happened", ""], ["agent", "which upstream's agent"], ["detail", "ids and decisions — never conversation text"]],
      agentOps.slice(0, Math.max(10, limit)).map((o) => h("tr", {},
        h("td", { class: "muted" }, fmt.t(o.ts)),
        h("td", { class: o.level === "warn" ? "warn" : "" }, h("span", { class: `pill${o.level === "warn" ? " warn" : ""}`, style: "margin-right:6px" }, o.sub || "event"), String(o.title || "").slice(0, 90)),
        h("td", {}, h("code", {}, String(o.ref?.upstreamId || o.detail?.upstream || "–"))),
        h("td", { class: "small muted" }, Object.entries(o.detail || {}).filter(([k]) => k !== "upstream" && k !== "bridge").slice(0, 4).map(([k, v]) => `${k}: ${v == null ? "–" : String(v).slice(0, 40)}`).join(" · "))))));
    const procs = s.processes || [];
    const procRows = procs.map((pr) => h("tr", {},
      h("td", {}, h("code", {}, String(pr.key || "–"))),
      h("td", { class: "num muted" }, pr.pid == null ? "–" : String(pr.pid)),
      h("td", { class: "num muted" }, pr.idleMs != null ? fmt.ms(pr.idleMs) : "–"),
      h("td", {}, pr.exited ? h("span", { class: "pill err" }, "exited") : h("span", { class: "pill ok" }, "running")),
      h("td", { class: "small muted" }, (pr.stderr || []).slice(-2).join(" | ").slice(0, 120))));
    if (procs.length) sec("Processes", table([["agent", ""], ["pid", ""], ["idle", ""], ["state", ""], ["stderr", "the last lines the agent printed on its error stream"]], procRows));

    const convs = s.conversations || [];
    const convRows = convs.map((c) => h("tr", {},
      h("td", {}, h("code", {}, String(c.sessionId || c.key || "–").slice(0, 20))),
      h("td", { class: "num" }, String(c.turns == null ? "–" : c.turns)),
      h("td", {}, h("span", { class: `pill${c.bridgeNote ? " warn" : ""}`, title: c.bridgeNote || null }, c.bridge || c.bridgeEffective || "–")),
      h("td", {}, c.steering ? "on" : "off"),
      h("td", {}, c.live ? h("span", { class: "pill live" }, "in flight") : "")));
    if (convs.length) sec("Conversations", table([["session", ""], ["turns", ""], ["bridge in force", "what the client actually got, which can differ from what is configured"], ["steering", "whether Filament's Rung-2 steering prompt was sent"], ["live", ""]], convRows));

    // `waiting` is an ARRAY of {kind, tool, handedOut, ageMs} — one entry per thing the agent is blocked on — not a
    // string, and there is no top-level `ageMs`. A turn also stays in the bridge's map for ~30 minutes after it
    // finishes, so `done` ones must be filtered out or a table headed "In flight right now" quietly lists history.
    const flying = (s.turns || []).filter((t) => !t.done);
    const flyRows = flying.map((t) => {
      const w = Array.isArray(t.waiting) ? t.waiting : [];
      const oldest = w.reduce((m, x) => (x && x.ageMs != null && (m == null || x.ageMs > m) ? x.ageMs : m), null);
      return h("tr", {},
        h("td", {}, h("code", {}, String(t.sessionId || "–").slice(0, 20))),
        h("td", {}, w.length ? w.map((x, i) => h("span", { class: "pill warn", style: i ? "margin-left:4px" : null, title: x.handedOut ? "handed to the chat client as one of its own tools" : "Filament is answering this itself" }, `${x.kind || "waiting"}${x.tool ? ` · ${x.tool}` : ""}`)) : h("span", { class: "muted" }, "working")),
        h("td", { class: "num muted", title: "how long the oldest thing it is waiting on has been waiting" }, oldest != null ? fmt.ms(oldest) : "–"),
        h("td", { class: "num muted" }, String(t.buffered == null ? "–" : t.buffered)));
    });
    if (flying.length) sec("In flight right now", table([["session", ""], ["waiting on", "what the agent is blocked on"], ["age", ""], ["buffered", "lines Filament is holding while a thought run finishes"]], flyRows));

    const hits = s.mcp || [];
    const hitRows = hits.slice(0, 40).map((m) => h("tr", {},
      h("td", { class: "muted" }, m.at ? fmt.t(m.at) : "–"),
      h("td", {}, h("code", {}, String(m.tool || m.name || "–"))),
      h("td", {}, h("span", { class: `pill${m.via === "filament" ? " warn" : ""}`, title: m.via === "filament" ? "Filament's own hands ran this — the client has no such tool" : null }, m.via || "–")),
      h("td", { class: "muted small" }, m.paged ? String(m.paged) : "–"),
      h("td", { class: "small muted" }, m.ok === false ? h("span", { class: "err" }, String(m.error || "failed").slice(0, 90)) : "ok")));
    if (hits.length) sec("Recent tool calls", table([["when", ""], ["tool", ""], ["who ran it", "client = the agent's own tool; Filament = Filament's hands, because the client has none"], ["paged", "Filament returned only part of a large result, with an offset to continue"], ["outcome", "an error here is the tool's own, not the agent's"]], hitRows));

    // A permission entry is `{at, upstream, policy, title, kind, decision}` — there is no `tool` and no `reason`, so
    // reading those left two of the four columns permanently blank. `decision` is an ACP option id, not allow/deny, so
    // it is shown as-is rather than coloured by a guess.
    const perms = s.permissions || [];
    const permRows = perms.slice(0, 30).map((pm) => h("tr", {},
      h("td", { class: "muted" }, pm.at ? fmt.t(pm.at) : "–"),
      h("td", {}, h("code", {}, String(pm.upstream || "–"))),
      h("td", { title: pm.title || null }, h("span", { class: "pill" }, String(pm.kind || pm.title || "–").slice(0, 40))),
      h("td", {}, h("span", { class: "pill ok" }, String(pm.decision || "–").slice(0, 30))),
      h("td", { class: "small muted" }, String(pm.policy || "").slice(0, 110))));
    if (perms.length) sec("Recent permission decisions", table([["when", ""], ["agent", "which upstream's agent asked"], ["what it asked", "the kind of permission, and the request itself on hover"], ["decided", "the option Filament chose"], ["how", "whether it asked you, was allowed to decide alone, or had to fall back"]], permRows));

    box.replaceChildren(cards, ...sections);
  }).catch((e) => box.replaceChildren(h("div", { class: "err small" }, `Could not read the agent status: ${e.message}`)));
  return box;
}
// ---- Live (W9 Phase E): everything in flight right now, from every source ---------------------------------------
// `usage.live()` does not filter by source, so a summary's slice call is on the Home live panel as it is in the Traffic
// list. This tab makes that intentional and adds the
// running jobs, so a five-minute compaction is a row with a percentage instead of an unexplained pending request.
function liveView() {
  const box = h("div", {}, h("span", { class: "muted small" }, "reading what is in flight…"));
  const draw = async () => {
    let live = [], jobs = [], eng = null;
    // `/api/jobs`, not `/api/memory/status`: the latter rebuilds the whole memory status — the archive's counts, the
    // engine's files, the backups' list — and this tab polls every 1.5 s for one small field.
    try { live = (await api("/live")).active || []; } catch {}
    try { const j = await api("/jobs"); jobs = j.jobs || []; eng = j.engine || null; } catch {}
    const engineBusy = !!(eng && eng.installed && eng.pending > 0);
    // Calls in flight that never end are how a hung engine shows here: Restart ends its process and starts it again
    // (HarnessV4_Tasks U1). The panel is drawn anew each tick, so the press is kept beside it.
    const restart = async () => { state.engineRestarting = true; draw(); await restartEngine({ api, toast }); state.engineRestarting = false; draw(); };
    if (!live.length && !jobs.length && !engineBusy) { box.replaceChildren(empty("Nothing in flight", "Requests and background jobs appear here while they run — how long they have been going, how much output has arrived, how quiet it has been, and what the agent said it was doing.")); return; }
    const parts = [];
    // In-flight engine calls. These used to be observable only as a counter on a request's memory trace, and only when
    // the call happened inside a request — the learner's mirroring and the nightly consolidation run outside any of
    // them, so nothing showed them at all.
    if (eng && eng.installed) parts.push(h("section", { class: "panel", style: "margin-bottom:18px" }, h("h2", {}, "Memory engine"),
      h("div", { class: "kv small" },
        h("span", {}, "state"), h("span", {}, String(eng.state || "–")),
        h("span", {}, "calls in flight"), h("span", { class: eng.pending ? "warn" : "muted", title: "Engine calls Filament is waiting on right now, including the ones no request is tracing" }, String(eng.pending || 0), " ", h("button", { class: "sm", style: "margin-left:8px", disabled: state.engineRestarting ? "" : null, title: RESTART_WORDS, onclick: restart }, state.engineRestarting ? "Restarting…" : "Restart engine")),
        h("span", {}, "calls total"), h("span", {}, fmt.n(eng.calls || 0)),
        eng.failures ? h("span", {}, "consecutive failures") : null, eng.failures ? h("span", { class: "err" }, String(eng.failures)) : null,
        eng.lastError ? h("span", {}, "last error") : null, eng.lastError ? h("span", { class: "err small" }, String(eng.lastError).slice(0, 120)) : null)));
    if (jobs.length) parts.push(h("section", { class: "panel", style: "margin-bottom:18px" }, h("h2", {}, `Background jobs (${jobs.length})`), ...jobs.map((j) => memJobPanel(j, () => {}))));
    if (live.length) parts.push(h("section", { class: "panel" }, h("h2", {}, `Requests in flight (${live.length})`),
      h("div", { class: "table-wrap" }, h("table", { class: "small" },
        h("thead", {}, h("tr", {}, ...[["when", ""], ["who", "whose call it is — yours or Filament's own"], ["model", ""], ["elapsed", ""], ["first byte", "how long the upstream took to start answering"], ["out so far", "estimated"], ["tok/s", "over the last second"], ["quiet for", "how long since output arrived; an agent thinking or running a tool shows as a pause"], ["stage", "what the agent said it was doing"]].map(([t, tip]) => h("th", { title: tip || null }, t)))),
        h("tbody", {}, ...liveTree(live, { fold: false }).map(({ r, depth }) => h("tr", { class: "clickable", onclick: () => openRequest(r.id) },
          h("td", { class: "muted" }, fmt.t(r.ts)),
          h("td", {}, sourcePill(r) || h("span", { class: "pill", title: state.schema?.trafficSources?.client?.hint || null }, "your tools")),
          h("td", depth ? { style: `padding-left:${8 + depth * 16}px`, title: "part of the turn above" } : {}, depth ? h("span", { class: "muted" }, "↳ ") : null, h("code", {}, String(r.model || "–"))),
          h("td", { class: "num" }, fmt.ms(r.elapsedMs)),
          h("td", { class: "num muted" }, r.waitMs != null ? fmt.ms(r.waitMs) : "–"),
          h("td", { class: "num" }, fmt.n(r.liveOutTokens || 0)),
          h("td", { class: "num muted" }, r.liveTpsNow != null ? String(r.liveTpsNow) : "–"),
          h("td", { class: `num${r.stalled ? " warn" : " muted"}` }, r.sinceOutputMs != null ? fmt.ms(r.sinceOutputMs) : "–"),
          h("td", { class: "small muted" }, r.now ? nowText(r.now) : r.stage || (r.phase === "streaming" ? "streaming" : "waiting for the first byte")))))))));
    box.replaceChildren(...parts);
  };
  draw();
  // Polled rather than pushed: `/api/live` recomputes elapsed and quiet-for on the server, so a tick is the only way
  // those numbers move. The interval stops itself when the tab is left, exactly like memJobPanel does.
  const t = setInterval(() => { if (!box.isConnected) { clearInterval(t); return; } draw(); }, 1500);
  return box;
}
let drawerSeq = 0; // late answers from a previous drawer open must not overwrite the current one
// The alerts strip: server-side thresholds (failover, a degraded engine, a day's cost, cache churn) come to find you.
function alertsBanner() {
  return h("div", { class: "alert-strip" },
    ...state.alerts.slice(0, 4).map((a) => h("div", { class: `alert-line ${a.kind}` }, h("b", {}, `${a.kind}:`), " ", String(a.text))),
    state.alerts.length > 4 ? h("div", { class: "muted small" }, `+ ${state.alerts.length - 4} more`) : null,
    h("button", { class: "sm ghost", title: "Dismiss these alerts (they do not return; new ones will)", onclick: async () => { try { await api("/alerts/ack", { method: "POST", body: {} }); } catch {} state.alerts = []; render(); } }, "Dismiss"));
}
async function openRequest(id) {
  const my = ++drawerSeq;
  const d = await api(`/requests/${id}`);
  if (my !== drawerSeq) return;
  const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
  const t = d.tokens || {}; const totalTok = (t.input || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) + (t.output || 0);
  const seg = (cls, v) => (v ? h("i", { class: cls, style: `width:${(v / totalTok) * 100}%`, title: `${cls}: ${fmt.n(v)}` }) : null);
  const wait = d.ttftMs || 0, total = d.totalMs || wait;
  // Replay & compare: send this exact stored body to another model (memory off, new linked record). Costs money.
  const replayBox = h("div", { class: "panel", style: "margin:0 0 12px" });
  // Side-by-side comparison: the original and the replay in two columns, first byte included. A delta column says
  // which way each number moved, because "340ms vs 1.2s" is only useful once you know which is which and whether
  // lower was the good direction. `cmpCell` takes the RAW values plus a formatter: passing pre-formatted strings
  // would leave the delta column permanently empty (it cannot subtract "1.2s").
  const cmpCell = (label, av, bv, better, f = (v) => String(v)) => {
    const cell = (v) => (v == null ? h("span", { class: "muted" }, "–") : f(v));
    let d = null;
    if (typeof av === "number" && typeof bv === "number" && better) {
      if (Math.abs(av - bv) < 1e-9) d = h("span", { class: "muted small" }, "same");
      else {
        const lower = av > bv; // the replay is the second column: "lower" means the replay beat the original
        const good = better === "lower" ? lower : !lower;
        const base = Math.max(Math.abs(av), Math.abs(bv)) || 1;
        const pct = Math.round((Math.abs(av - bv) / base) * 100);
        d = h("span", { class: `small ${good ? "ok" : "warn"}`, title: good ? "the replay is better on this measure" : "the replay is worse on this measure" }, `${lower ? "▼" : "▲"} ${pct}%`);
      }
    }
    return h("tr", {}, h("td", { class: "muted small" }, label), h("td", {}, cell(av)), h("td", {}, cell(bv)), h("td", {}, d));
  };
  const drawReplay = (r) => {
    const c = r.compare || {};
    const o = c.original || {}, p = c.replay || {};
    // The honesty note: a first-byte time is only comparable with another first-byte time. `ttftReal` says whether
    // this side's number is a genuine first byte or the moment a whole buffered reply was ready — keyed on what the
    // upstream actually did, not on what the client asked for, because a provider that answers JSON to a streamed
    // request would otherwise pass a total off as a TTFT.
    const real = (s) => (s.ttftReal != null ? !!s.ttftReal : s.streamed !== false);
    const ttftComparable = real(o) && real(p);
    const caveat = !ttftComparable
      ? h("p", { class: "small muted", style: "margin:6px 0 0" }, !real(o) && !real(p)
        ? "Neither side streamed, so “first byte” is really the whole reply on both — compare the totals."
        : `${!real(o) ? "The original" : "The replay"} did not get a streamed reply, so its “first byte” is really its whole response time. Compare totals, not first bytes — the two numbers do not mean the same thing, so no delta is shown for that row.`)
      : "";
    const table = h("table", { class: "small cmp" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, h("div", {}, "original"), h("code", { class: "small" }, o.model || d.model)), h("th", {}, h("div", {}, "replay"), h("code", { class: "small" }, p.model || r.model)), h("th", { title: "which way the replay moved, and by how much" }, "Δ"))),
      h("tbody", {},
        cmpCell("first byte", o.ttftMs ?? null, p.ttftMs ?? null, ttftComparable ? "lower" : null, fmt.ms),
        cmpCell("total", o.totalMs ?? null, p.totalMs ?? null, "lower", fmt.ms),
        cmpCell("tok/s", o.tps ?? null, p.tps ?? null, "higher"),
        cmpCell("tokens in", o.tokens?.input ?? null, p.tokens?.input ?? null, "lower", fmt.n),
        cmpCell("tokens out", o.tokens?.output ?? null, p.tokens?.output ?? null, "lower", fmt.n),
        cmpCell("cost", o.cost ?? null, p.cost ?? null, "lower", fmt.usd),
        cmpCell("status", o.status || null, p.status || null, null),
        cmpCell("upstream", o.upstream || null, p.upstream || null, null)));
    const earlier = h("div", { class: "replay-earlier" });
    // Earlier replays of this same request, so a third opinion does not need the drawer reopened.
    api(`/requests/${encodeURIComponent(id)}/replays`).then((x) => {
      if (my !== drawerSeq) return; // this drawer was closed or replaced: do not write into a detached node
      const rows = (x.replays || []).filter((q) => q.id !== p.id);
      if (!rows.length) return;
      earlier.replaceChildren(h("details", {}, h("summary", {}, `${rows.length} earlier replay${rows.length === 1 ? "" : "s"} of this request`),
        h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["model", "first byte", "total", "tok/s", "out", "cost", "status"].map((t2) => h("th", {}, t2)))),
          h("tbody", {}, ...rows.map((q) => h("tr", { class: "clickable", onclick: () => openRequest(q.id) },
            h("td", {}, h("code", {}, q.model)), h("td", {}, fmt.ms(q.ttftMs)), h("td", {}, fmt.ms(q.totalMs)),
            h("td", {}, q.tps ?? "–"), h("td", {}, fmt.n(q.tokens?.output)), h("td", {}, q.cost != null ? fmt.usd(q.cost) : "–"),
            h("td", {}, statusPill(q))))))));
    }).catch(() => {});
    replayBox.replaceChildren(...[
      h("div", { class: "row", style: "margin:0 0 8px;align-items:center" }, h("b", {}, "Replay & compare"), r.ok ? h("span", { class: "pill ok" }, "replayed") : h("span", { class: "pill err" }, "failed"), h("span", { class: "grow" }), h("span", { class: "muted small" }, r.record?.id ? `record ${r.record.id}` : "")),
      r.error ? h("p", { class: "err small" }, r.error) : null,
      table, caveat,
      h("h4", { style: "margin:10px 0 4px" }, `The replay's reply (${p.model || r.model})`),
      h("div", { class: "mem-render" }, r.reply || "(no text in the reply)"),
      earlier].filter((x) => x != null));
  };
  {
    const agentUp = new Set((state.config?.upstreams || []).filter(isAgentUp).map((u) => u.id));
    const fill = (sel) => { const cat = modelCatalog(); const models = ((cat ? cat.models : state._modelNames || [])).filter((m) => !agentUp.has(m.upstream)).map((m) => m.id); const keep = sel.value; sel.replaceChildren(...models.map((id2) => h("option", { value: id2 }, id2))); if (keep && models.includes(keep)) sel.value = keep; return models.length; };
    const sel = h("select", { class: "sm grow", title: "The stored body is sent to this model as it arrived (secrets were redacted when it was stored; memory off; thinking and effort rules apply). Coding agents are refused — replaying one would run it for real." });
    // The catalog loads asynchronously, and `loadAll` throws it away whenever the config changes — which can happen
    // while this drawer is open. Chaining once onto `state._catalogPending` is not enough: that promise may already
    // have been replaced, leaving the picker empty and Replay unusable with no way to recover but a page reload.
    // Retry until it fills, bounded, preserving anything the user already picked.
    let fills = 0;
    const attemptFill = () => {
      if (my !== drawerSeq) return; // this drawer was closed or replaced: stop touching a detached select
      if (fill(sel)) return;
      if (++fills > 25) { sel.replaceChildren(h("option", { value: "" }, "no models discovered — see the Models page")); return; }
      try { state._catalogPending?.catch?.(() => {}); } catch {}
      setTimeout(attemptFill, 400);
    };
    attemptFill();
    const btn = h("button", { class: "sm", title: "Replays are real model calls and cost real money" }, "Replay");
    btn.onclick = () => { if (!sel.value) return toast("Pick a model first", "err"); btn.disabled = true; btn.textContent = "replaying…"; api(`/requests/${encodeURIComponent(id)}/replay`, { method: "POST", body: { model: sel.value } }).then((r) => { drawReplay(r); toast(r.ok ? `Replayed on ${r.model}` : `Replay failed: ${r.error}`, r.ok ? "" : "err"); loadRequests(); }).catch((e) => { toast(e.message, "err"); }).finally(() => { btn.disabled = false; btn.textContent = "Replay"; }); };
    replayBox.replaceChildren(h("div", { class: "row", style: "margin:0;gap:8px;align-items:center" }, h("b", {}, "Replay & compare"), sel, btn, h("span", { class: "muted small" }, "same body, another model · real call, real cost")));
  }
  openDrawer(`Request ${d.id}`, h("div", {},
    replayBox,
    h("div", { class: "kv" }, h("span", {}, "model"), h("code", {}, d.model), h("span", {}, "upstream"), h("code", { title: d.upstream || null }, whereWent(d)), h("span", {}, "status"), statusPill(d), h("span", {}, "stop reason"), h("span", {}, d.stopReason || "–"), h("span", {}, "when"), h("span", {}, new Date(d.ts).toLocaleString()), h("span", {}, "client"), h("span", {}, d.ua || "–"),
    // P8: which endpoint this tool is connected through, because it decides what an agent's reasoning can look like.
    // An Anthropic-format connection carries one thinking block per thought in the order they happened; an OpenAI-format
    // one keeps a single reasoning part and a single text part per reply, so a thought that arrives after the answer
    // began has to be woven into the text as a `> 💭` quote instead. Users hit that symptom without knowing the cause
    // is the endpoint their client was pointed at, so it is shown per request rather than left in the guide.
    h("span", { title: "The endpoint this tool talks to Filament through. Anthropic (/v1/messages) carries one thinking block per thought, in order. An OpenAI-format endpoint (/v1/chat/completions, /v1/responses) keeps one reasoning part and one text part per reply, so with acp.thoughts = auto a thought arriving after the answer began is woven into the text as a quoted 💭 paragraph instead; acp.thoughts = thinking-block keeps it native at the cost of the client painting it in the wrong place. Re-point the tool at /v1/messages if it can." }, "connected as"),
    // `/v1/responses` is converted to a chat request internally, so its record carries `format: "openai"` — naming
    // /v1/chat/completions for it would state an endpoint the client never spoke, in the one field whose whole job is
    // to say which endpoint it spoke. `api` distinguishes them and is already on the record.
    h("span", {}, d.api === "responses" ? "OpenAI · /v1/responses" : d.format === "anthropic" ? "Anthropic · /v1/messages" : d.format === "openai" ? "OpenAI · /v1/chat/completions" : d.format === "embeddings" ? "Embeddings · /v1/embeddings" : (d.format || "–")), d.clientSession ? h("span", {}, "chat session") : null, d.clientSession ? h("code", {}, d.clientSession) : null, d.contextUsed ? h("span", {}, "agent context") : null, d.contextUsed ? h("span", {}, `${fmt.n(d.contextUsed)}${d.contextSize ? ` of ${fmt.n(d.contextSize)} tokens (${Math.round((100 * d.contextUsed) / d.contextSize)}%)` : " tokens"}`) : null,
    // §10 asks the dashboard to show the bridge mode in force and the tool-announce dedupe stats. The record is not a
    // dashboard, so both are rendered here: what the turn actually got (against what was configured, when they differ)
    // and how much of the agent's tool chatter quiet mode merged away instead of printing.
    d.acp?.bridge ? h("span", {}, "bridge in force") : null,
    d.acp?.bridge ? h("span", { title: (BRIDGE_HINT[d.acp.bridge] || "") + (d.acp.configuredBridge && d.acp.configuredBridge !== d.acp.bridge ? `\n\nThe upstream is configured for “${d.acp.configuredBridge}”; this turn got “${d.acp.bridge}”. See the note under Changes applied for why.` : "") }, h("code", {}, d.acp.bridge), d.acp.configuredBridge && d.acp.configuredBridge !== d.acp.bridge ? h("span", { class: "muted small" }, ` (configured ${d.acp.configuredBridge})`) : null) : null,
    d.acp?.toolStats?.calls ? h("span", {}, "tool activity") : null,
    d.acp?.toolStats?.calls ? (() => {
      const st = d.acp.toolStats; const routed = st.routed || 0, built = st.builtIn || 0;
      const SEP = "·"; // a local, not an interpolation: this line is browser-only and no test imports it
      // The leak percentage is only meaningful when Filament's toolset was actually offered this turn. On an ordinary
      // `prompts` turn every call is the agent's own by design, so "100% leak" would be a number measuring nothing.
      const offered = !!d.acp.steering || d.acp.bridge === "native";
      return h("span", { title: "Calls the agent made, how many were announced in the reply, how many progress updates were merged silently instead of printed, and how many failed. “its own” counts calls the agent made with its BUILT-IN tools instead of Filament's. The leak percentage is shown only when Filament's toolset was actually offered this turn (steering, or native bridge) — otherwise every call is the agent's own by design and a rate would measure nothing." }, `${fmt.n(st.calls)} call${st.calls === 1 ? "" : "s"} ${SEP} ${fmt.n(st.announced)} announced ${SEP} ${fmt.n(st.updatesMerged)} update${st.updatesMerged === 1 ? "" : "s"} merged away${st.failures ? ` ${SEP} ${fmt.n(st.failures)} failed` : ""}${routed || built ? ` ${SEP} ${fmt.n(routed)} via Filament, ${fmt.n(built)} its own${offered && st.leakRate != null ? ` (${st.leakRate}% leak)` : ""}` : ""}`);
    })() : null,
    d.acp?.steering ? h("span", {}, "steering") : null,
    d.acp?.steering ? h("span", { class: "muted small" }, "on for this session · the agent was offered Filament's tools and asked to prefer them, but kept its own") : null),
    failoverCard(d),
    h("div", { class: "detail-grid" },
      h("div", { class: "card" }, h("h4", {}, "Timing"), h("div", { class: "timing" }, total ? h("i", { class: "wait", style: `width:${(wait / total) * 100}%`, title: `waiting for the first byte: ${fmt.ms(wait)}` }) : null, total ? h("i", { class: "stream", style: `width:${((total - wait) / total) * 100}%`, title: `receiving the reply: ${fmt.ms(total - wait)}` }) : null), h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--warn)" }), `first byte after ${fmt.ms(d.ttftMs)}`), h("span", {}, h("i", { style: "background:var(--accent)" }), `reply took ${fmt.ms(total - wait)}`), h("span", {}, `total ${fmt.ms(d.totalMs)}`), d.tps != null ? h("span", {}, `${d.tps} tok/s`) : null)),
      h("div", { class: "card" }, h("h4", {}, `Tokens · ${fmt.n(totalTok)}${d.estimatedTokens ? " (estimated)" : ""}`), h("div", { class: "tokbar" }, seg("in", t.input), seg("cr", t.cacheRead), seg("cw", t.cacheWrite), seg("out", t.output)), h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--accent-2);opacity:.55" }), `${fmt.n(t.input)} fresh input`), h("span", {}, h("i", { style: "background:var(--ok);opacity:.7" }), `${fmt.n(t.cacheRead)} cache read`), h("span", {}, h("i", { style: "background:var(--warn);opacity:.7" }), `${fmt.n(t.cacheWrite)} cache write`), h("span", {}, h("i", { style: "background:var(--accent)" }), `${fmt.n(t.output)} output`), t.thinking ? h("span", {}, `${fmt.n(t.thinking)} of the output was thinking`) : null), h("p", { class: "small muted", style: "margin:8px 0 0" }, d.estimatedTokens ? `The agent reports no usage, so tokens are Filament's local estimate (class-weighted per token type) and the cost is covered by its subscription.${typeof d.listCost === "number" ? ` At list price: ${fmt.usd(d.listCost)}, from the price you set for it.` : ""}` : billingWords(d)))),
    d.memory || d.memoryTrace ? h("div", { class: "detail-grid one" }, d.memory ? memKnewCard(d) : null, memTimelineCard(d)) : null,
    d.error ? h("p", { class: "err" }, d.error) : null,
    streamedOf(d) ? h("p", { class: "small muted" }, streamedOf(d)?.words) : null,
    d.providerMeta ? h("details", {}, h("summary", {}, "Provider metadata (response headers: rate limits, ids)"), h("pre", {}, JSON.stringify(d.providerMeta, null, 2))) : null,
    h("h4", {}, "Changes applied"), d.changes?.length ? h("ul", {}, ...d.changes.map((c) => h("li", {}, c))) : h("p", { class: "muted" }, "none"),
    d.translation ? h("div", {}, h("h4", {}, "Received vs sent (no message content stored)"), h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "field"), h("th", {}, "received from agent"), h("th", {}, "sent upstream"))), h("tbody", {}, ...["model", "stream", "max_tokens", "thinking", "effort", "messages", "roles", "tools", "systemChars", "cacheMarkers", "sampling", "bytes"].map((k) => { const a = d.translation.received?.[k], b = d.translation.sent?.[k]; const s = (v) => (v == null ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v)); return h("tr", { class: s(a) !== s(b) ? "changed" : "" }, h("td", {}, k), h("td", {}, h("code", {}, s(a))), h("td", {}, h("code", {}, s(b)))); })))) : null,
    d.shapedHeaders ? h("details", {}, h("summary", {}, "Headers sent upstream"), h("pre", {}, JSON.stringify(d.shapedHeaders, null, 2))) : null,
    // Say WHY there is no body, and name the knob that actually governs it. `bodyWithheld` is set on Filament's own
    // calls (memory, summaries, the engine, the assistant, pings) whose prompts are your conversation text; pointing those
    // at `storeBodies` sends the user to a setting that is already on and changes nothing.
    d.shapedBody ? h("details", { open: "" }, h("summary", {}, `Body sent upstream (${d.url || ""})`), h("pre", {}, pretty(d.shapedBody))) : h("p", { class: "muted small", title: d.bodyWithheld || null }, d.bodyWithheld || "Bodies not stored (observability.storeBodies is summary or none)."),
    d.inboundBody ? h("details", {}, h("summary", {}, "Body received from the agent"), h("pre", {}, pretty(d.inboundBody))) : null));
}

function openRulesDrawer(title, overrides, inherited, scopeLabel = "this layer") {
  openDrawer(title, h("div", {},
    h("div", { class: "intro-body", style: "border:1px solid var(--line);border-radius:var(--r-sm);padding:12px 14px;margin-bottom:14px;background:var(--surface-2)" },
      h("p", { style: "margin:0 0 6px" }, h("b", {}, "What this is. "), "The same settings as the Rules page (how thinking, effort, speed, headers, caching and streaming are shaped), but applied to ", h("b", {}, scopeLabel), ". Every field starts on “inherit”, meaning it uses the value shown next to it from the layer below. Untick inherit to set your own value for this scope only."),
      h("p", { class: "small muted", style: "margin:0" }, "Layers: global Rules page → upstream overrides → route overrides. The most specific one wins. Typical uses: force streaming on for one provider, cap effort on a cheap route, add a beta header only for Anthropic. Templates write into these same fields, so a template you applied may already have set some of them. Save changes when done.")),
    schemaForm(state.schema.rules, overrides, () => markDirty(), { inheritFrom: inherited })));
}
bindDrawer();

function hashFor() {
  return formatHash(state);
}
function drawPageTabs() {
  const el = $("#page-tabs");
  const hub = HUBS[state.tab];
  if (!hub) { el.replaceChildren(); el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const current = hub.sameView ? state.homePane : state.tab;
  el.replaceChildren(...hub.tabs.map(([id, label]) => h("button", { class: id === current ? "on" : "", onclick: () => {
    if (hub.sameView) go("overview", id);
    else go(id);
  } }, label)));
}

function paletteCommands() {
  const c = state.config;
  const base = c ? serverBase(c.server) : "";
  const cmds = palettePages().map((p) => ({
    id: p.id,
    label: p.label,
    hint: p.hint,
    run: () => {
      if (p.filter) setReqFilter({ tab: p.filter });
      if (p.pane) go("overview", p.pane);
      else go(p.tab, p.section || null);
    },
  }));
  cmds.push(
    { id: "docs:commands", label: "Docs → Commands", hint: "Everything you can type into a chat", run: () => { (state.docs ||= { file: "GUIDE.md", q: "", cache: {} }).file = "COMMANDS"; go("docs"); } },
    { id: "copy-url", label: "Copy base URL", hint: base ? `${base}/v1` : "", run: () => { if (base) navigator.clipboard?.writeText(`${base}/v1`).then(() => toast("Copied base URL")); } },
    { id: "copy-key", label: "Copy inbound API key", hint: "Current key", run: () => { const k = state.keys?.[0]; if (k) navigator.clipboard?.writeText(k).then(() => toast("Copied inbound key")); else toast(state.keysWhy || "No inbound key", "err"); } },
    { id: "last-error", label: "Open last failed request", hint: "Traffic drawer", run: () => { const r = state.requests.find((x) => x.status === "error"); if (r) openRequest(r.id); else toast("No failed requests in memory", "err"); } },
    { id: "failover", label: "Toggle failover", hint: c?.rules?.resilience?.failover === true ? "currently on" : "currently off", run: async () => { try { const on = c?.rules?.resilience?.failover === true; await api("/failover", { method: "POST", body: { enabled: !on } }); toast(!on ? "Failover on" : "Failover off"); await loadAll({ force: true }); } catch (e) { toast(e.message, "err"); } } },
    { id: "theme-dark", label: "Theme: Slate", hint: "Dark", run: () => applyTheme("dark") },
    { id: "theme-light", label: "Theme: Paper", hint: "Light", run: () => applyTheme("light") },
    { id: "theme-midnight", label: "Theme: Midnight", hint: "Cool dark", run: () => applyTheme("midnight") },
    { id: "theme-contrast", label: "Theme: Contrast", hint: "High contrast", run: () => applyTheme("contrast") },
    { id: "density", label: "Toggle compact density", hint: document.documentElement.dataset.density === "compact" ? "currently compact" : "currently comfortable", run: () => applyDensity(document.documentElement.dataset.density === "compact" ? "comfortable" : "compact") },
  );
  if (c?.upstreams) for (const u of c.upstreams) cmds.push({ id: `up:${u.id}`, label: `Upstream: ${u.name || u.id}`, hint: u.type, run: () => { state.selUp = u.id; go("upstreams"); } });
  if (c?.routes) for (const r of c.routes) cmds.push({ id: `rt:${r.match}`, label: `Route ${r.match}`, hint: r.upstream, run: () => go("routes") });
  return cmds;
}
const { openPalette } = createPalette({ closePops, closePalette, commands: paletteCommands });
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const pal = $("#palette"); const palOpen = pal && !pal.classList.contains("hidden");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palOpen ? closePalette() : openPalette(); return; }
  // The field being typed in keeps its edit on its `change`, which a press on Save fires by taking the focus: Ctrl+S
  // takes it the same way before it saves.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); commitFocused(); if (state.dirty && !$("#save").disabled) $("#save").click(); return; }
  if (e.key === "Escape") {
    if (palOpen) { closePalette(); return; }
    if (!$("#help-pop").classList.contains("hidden") || !$("#appear-pop").classList.contains("hidden")) { closePops(); return; }
    if (!$("#drawer").classList.contains("hidden")) closeDrawer();
    return;
  }
  if (!typing && e.key === "/") { e.preventDefault(); openPalette(); }
});

// ---------------------------------------------------------------------------------------------------
// Data + boot
// ---------------------------------------------------------------------------------------------------
// scope=all: Traffic is one feed now, so the client holds every call — yours and Filament's own — and the tabs filter
// it locally. Asking the server per tab would make switching tabs a round trip and would desync from the live stream.
async function loadRequests() { state.requests = (await api("/requests?limit=300&scope=all")).requests; state.alerts = (await api("/alerts").catch(() => ({ alerts: [] }))).alerts || []; }
// Operations: everything that is not a model call. Fetched with `kinds=all` so the client holds the firehose too and
// the chips can filter locally without a round trip — the server's default would hide the noisy kinds.
async function loadOps() {
  try { const j = await api("/ops?limit=300&kinds=all"); state.ops = j.ops || []; state.opCounts = j.counts || {}; state.opWired = j.wired || null; }
  catch { state.ops = []; state.opCounts = {}; }
}
// The Context tab's report: strategies compared and every session's view choice. Assembled server-side on read.
const readAlerts = () => api("/alerts").then((a) => { const before = state.alerts?.length || 0; state.alerts = a.alerts || []; if (state.alerts.length !== before) render(); }).catch(() => {});
setInterval(readAlerts, 30_000);
async function loadAll({ force = false } = {}) {
  if (state.dirty) {
    if (!force && !confirm("Reload the saved configuration from the server? Your unsaved edits will be discarded.")) return false;
    toast("Your unsaved edits were replaced by the configuration saved on the server", "err");
  }
  state._catalog = null; state._catalogPending = null; state._modelNames = null; if (state.catalog) { state.catalog.cache = null; state.catalog.at = null; } // the config changed: model lists must come back
  // The templates a view-only device may not read (remote.js VIEW_ROUTES): none, and its console still opens.
  const [st, schema, tpl, keys, start] = await Promise.all([api("/state"), api("/schema"), api("/templates").catch((e) => { if (e?.status === 403) return { templates: [] }; throw e; }), api("/keys").catch((e) => ({ keys: [], why: String(e?.message || "") })), api("/start").catch(() => null)]);
  starts.set(start);
  // A view-only device's console reads its traffic and usage and asks no write of the server (lib/api.js
  // `setViewOnly`, the review of p4-view-ui): no Save changes, and its status line says so.
  setViewOnly(viewOnlyOf(st));
  $("#config-actions").classList.toggle("hidden", viewOnlyNow());
  state.config = st.config; state.saved = structuredClone(st.config); state.unreadable = st.unreadable || []; state.summary = st.summary; state.schema = schema; state.templates = tpl.templates; state.keys = keys.keys || []; state.keysWhy = keys.why || ""; // another machine's console is told why there is none (the hunt of p1-keys)
  configFollow.loaded(st.configVersion);
  state.meta ={ version: st.version, uptimeMs: st.uptimeMs, port: st.config.server.port };
  $("#version").textContent = `v${st.version}`;
  setStatus("ok", `Running on port ${st.config.server.port}${viewOnlyNow() ? " · view-only: this device changes nothing" : ""}`);
  // The lists the Traffic tabs read are part of boot, not of a tab's render: a view that fetches its own data on every
  // render would refetch on each 1.5 s live tick, and a view that expects data nobody loaded renders its empty state
  // forever while every gate stays green.
  await Promise.all([loadRequests(), loadOps()]); markDirty(false);
  render();
}
// Reload the saved configuration and land on a tab, but never silently discard unsaved edits (Qoder polls and
// agent detection resolve long after the click that started them; the user may be mid-edit anywhere by then).
async function loadSavedAndGo(tab = "upstreams") {
  if (state.dirty && !confirm("This reloads the saved configuration from the server, which discards your unsaved edits. Continue?")) return false;
  await loadAll({ force: true }); state.tab = tab; render(); return true;
}
function render() {
  const v = views[state.tab];
  const [title, sub0] = PAGES[state.tab] || [state.tab, ""];
  const sub = state.tab === "overview" ? (HOME_SUB[state.homePane] || sub0) : sub0;
  $("#page-title").textContent = title; $("#page-sub").textContent = sub; document.title = `${title} · Filament console`;
  const view = $("#view");
  const sig = `${state.tab}:${state.homePane}:${state.section || ""}`;
  const moved = state._viewSig !== sig;
  state._viewSig = sig;
  try { view.replaceChildren(...(engineBar.shown() ? [engineBar.el] : []), ...(state.alerts?.length ? [alertsBanner()] : []), v ? v() : empty("Unknown page", state.tab)); }
  catch (e) { console.error(e); view.replaceChildren(empty("This page failed to render", `${e.message} — reload the page; if it persists, report it with this message.`), h("pre", { class: "small" }, e.stack || "")); }
  if (moved) { view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter"); }
  const nid = navId(state.tab);
  for (const b of $("#tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.nav === nid);
  $("#btn-assistant").classList.toggle("active", state.tab === "assistant");
  $("#btn-help").classList.toggle("active", nid === "help");
  drawPageTabs();
  syncSaveBar();
  navBadges();
  const want = hashFor();
  if (location.hash !== want) history.replaceState(null, "", want);
  if (state.section && ["concepts", "docs"].includes(state.tab)) {
    const el = document.getElementById(`${state.tab}-${state.section}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    state.section = null;
  }
}
function applyHash() {
  const patch = parseHash(location.hash.slice(1));
  if (!patch) return false;
  if (patch.tab && !views[patch.tab]) return false;
  state.tab = patch.tab;
  if (patch.homePane) { state.homePane = patch.homePane; store.set("home.pane", patch.homePane); }
  state.section = patch.section ?? null;
  if (patch.memSel) state.memSel = patch.memSel;
  if (patch.reqFilter) setReqFilter(patch.reqFilter);
  return true;
}
$("#tabs").onclick = (e) => { const t = e.target.closest("button")?.dataset.tab; if (t) go(t); };
// The Traffic sub-tab and its chain filter live in state.reqFilter, not in `section`, so they must be part of the
// "did anything change" key — otherwise `#requests:memory` → `#requests:agents` parses correctly and renders
// nothing, leaving the old tab on screen. A route that silently does not navigate is worse than one that 404s.
window.addEventListener("hashchange", () => { const key = () => `${state.tab}:${state.homePane || ""}:${state.section || ""}:${state.memSel || ""}:${state.reqFilter?.tab || ""}`; const before = key(); if (applyHash() && key() !== before) render(); });

$("#discard").onclick = () => { if (!state.dirty || !confirm("Throw away your unsaved edits?")) return; state.config = structuredClone(state.saved); markDirty(false); closeDrawer({ force: true }); toast("Unsaved edits discarded"); render(); configFollow.settled(); };
$("#save").onclick = async () => { try { const r = await putConfig(state.config); state.config = r.config; state.saved = structuredClone(r.config); markDirty(false); closeDrawer(); const btn = $("#save"); btn.classList.add("ok"); btn.textContent = CHROME.saved; setTimeout(() => { btn.classList.remove("ok"); btn.textContent = CHROME.save; }, 900); toast(CHROME.saved); render(); } catch (e) { toast(e.message, "err"); } };

// Re-render at most every 1.5 s while traffic flows (a burst of events must not rebuild the page for each one), and
// never while the user is typing into a field on the page.
function scheduleRender(refreshSummary = false) {
  if (refreshSummary) state._wantSummary = true;
  if (state._renderTimer) return;
  state._renderTimer = setTimeout(async () => {
    state._renderTimer = null;
    const a = document.activeElement; if (a && $("#view").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return scheduleRender(state._wantSummary);
    if (state._wantSummary) { state._wantSummary = false; try { state.summary = await api("/usage/summary"); } catch {} }
    if (!state.dirty) render();
  }, 1500);
}
/** What hears every message on the events stream besides this handler: the memory panels (HarnessV3-Memory M7-D37). */
const eventListeners = listenerSet();
/** Hear every message on the events stream, its `hello` on each (re)connect included; returns the undo. */
const onEvents = (fn) => eventListeners.on(fn);
// Memory's engine installing (HarnessV3-AtHome AH-D2): a line above every page, changed in place. An
// install that ends without the engine raised an alert when nobody pressed for it: the banner reads it now, not at its
// next poll.
const engineBar = engineLine({ h, onShown: (on) => { if (on) $("#view").prepend(engineBar.el); else engineBar.el.remove(); }, onFailed: readAlerts });
followEngine(onEvents, { read: () => api("/memory/engine"), onSaid: (now) => engineBar.set(now) });
// The coding agents' accounts and their plans' windows (HarnessV3-ACP AC3-6), kept as the server says them: Home →
// Health draws them on its cards, drawn again as they move.
followAccounts(onEvents, { read: () => api("/agent-accounts"), onSaid: (rows) => { state.accounts = rows; if (state.tab === "overview" && state.homePane === "health" && state.live && !state.dirty) scheduleRender(false); } });
// The draft against the configuration as it stands (HarnessV4_Settings_Plan HS-D3, ui/lib/config-follow.js): a save
// elsewhere reads in quietly under a clean draft, and under an edited one (or a sheet with edits of its own, such as
// Tune) shows the bar, which names the change and offers Reload or Keep mine.
const staleBar = $("#stale-bar");
/** @param {{ count: number | null, changes: string[] | null } | null} said */
function sayStale(said) {
  if (!said) { staleBar.classList.add("hidden"); staleBar.replaceChildren(); return; }
  const lines = said.changes || [];
  const n = said.count ?? lines.length;
  const what = lines.length ? `${lines[0]}${n > 1 ? ` and ${n - 1} more` : ""}` : "too long ago to say what";
  staleBar.replaceChildren(
    h("span", { class: "dirty-dot", "aria-hidden": "true" }),
    h("span", { title: lines.join("\n") }, `Changed in another window: ${what}. `, h("span", { class: "muted" }, "Keep mine, and your next Save overwrites it.")),
    h("span", { class: "grow" }),
    h("button", { class: "sm", onclick: () => { closeDrawer({ force: true }); loadAll({ force: true }); } }, "Reload"),
    h("button", { class: "sm ghost", title: "Keep your edits: Save changes then overwrites the change named here", onclick: () => { configFollow.keepMine(); toast("Kept yours: Save changes overwrites the other window's change"); } }, "Keep mine"));
  staleBar.classList.remove("hidden");
}
const configFollow = followConfig({
  dirty: () => state.dirty || drawerHolds(),
  reload: async () => {
    const st = await api("/state");
    setViewOnly(viewOnlyOf(st));
    if (state.dirty || drawerHolds()) return null;
    state.config = st.config; state.saved = structuredClone(st.config); state.unreadable = st.unreadable || []; state.summary = st.summary;
    state._catalog = null; state._catalogPending = null; state._modelNames = null; if (state.catalog) { state.catalog.cache = null; state.catalog.at = null; }
    scheduleRender(false);
    return st.configVersion;
  },
  changes: (since) => api(`/config/changes?since=${since}`),
  bar: sayStale,
});
/**
 * A whole configuration saved — the draft, or a page's copy of it — naming the version it overwrites and the one the
 * draft was read at: a newer save elsewhere refuses it (409) with what changed, which the bar then names.
 * @param {any} body
 */
function putConfig(body) {
  return configFollow.own(async () => {
    try {
      const r = await api(`/config?base=${configFollow.base()}&read=${configFollow.read()}`, { method: "PUT", body });
      configFollow.loaded(r.version);
      state.unreadable = r.unreadable || [];
      return r;
    } catch (e) {
      if (e.status === 409 && e.body?.stale) configFollow.refused(e.body);
      throw e;
    }
  });
}
/** The events stream said `hello` once already: the next one is a stream that was lost and opened again. */
let streamGreeted = false;
/**
 * The lists the events stream feeds, read again, for a stream that opened again: what ended while it was away never
 * reached this page. A restart of Filament ends every call in flight without a word, and a page left open kept their
 * rows "in flight" until a reload (HarnessV4_Tasks U1, found in the live drive).
 */
function readTrafficAgain() {
  Promise.all([loadRequests(), loadOps()]).then(
    () => { navBadges(); if (state.live && ["requests", "overview", "guide", "usage"].includes(state.tab) && !state.dirty) scheduleRender(true); },
    (e) => setStatus("err", `Connected again, but the traffic could not be read: ${e.message}`),
  );
}
function connectEvents() {
  const es = new EventSource("/api/events");
  // Put away, the page lets the stream go (ui/lib/put-away.js); brought back, it loads afresh.
  const letGo = holdWhileShown(() => es.close());
  es.onmessage = (m) => {
    let ev; try { ev = JSON.parse(m.data); } catch { return; }
    // A listener's failure is reported, never allowed to keep the message from the others or from this handler.
    eventListeners.hand(ev);
    // A stream opened again may have missed a save: the version the server holds now is asked.
    if (ev?.type === "hello") { if (streamGreeted) { readTrafficAgain(); api("/state").then((st) => { setViewOnly(viewOnlyOf(st)); configFollow.heard(st.configVersion); }, () => {}); } streamGreeted = true; return; }
    if (ev?.type === "config-changed") { configFollow.heard(ev.version); return; }
    // A save's discovery answered (Providers P0): the model lists this page holds are old. Forget them; the pages that
    // show them draw again, unless an edit is open (the next draw reads the new list).
    if (ev?.type === "models-discovered") {
      state._catalog = null; state._catalogPending = null; if (state.catalog) state.catalog.cache = null;
      if (["upstreams", "models", "routes"].includes(state.tab) && !state.dirty) render();
      starts.stale(); if (["overview", "guide"].includes(state.tab)) startFacts(); // Get started may tick now
      return;
    }
    // Operations arrive as `{type:"op", op}` and carry no `record`, so they must be handled before the record bail-out
    // below. One stream, two item types — which is what lets the All tab show a compaction next to the request that
    // caused it instead of making you look at two pages and match timestamps.
    if (ev?.op) {
      const L = state.ops; const j = L.findIndex((o) => o.id === ev.op.id);
      if (j >= 0) L[j] = ev.op; else L.unshift(ev.op);
      if (L.length > 1000) L.length = 1000;
      if (state.live && ["requests", "overview"].includes(state.tab) && !state.dirty) scheduleRender(false);
      return;
    }
    if (!ev?.record) return;
    // ONE feed: every record lands in state.requests, memory's own calls among them, and the Traffic tabs filter it
    // locally; `source` on the record says whose call it was.
    const i = state.requests.findIndex((r) => r.id === ev.record.id); if (i >= 0) state.requests[i] = ev.record; else state.requests.unshift(ev.record); state.requests = state.requests.slice(0, 500);
    navBadges();
    if (ev.type === "progress") { startLiveTicker(); return; } // cheap: the one-second ticker repaints the live panel and the unfinished table rows
    if (ev.type === "first-byte") { startLiveTicker(); liveTick(); return; } // pending → in flight, at once
    if (ev.type === "start") startLiveTicker();
    if (state.live && ["requests", "overview", "guide", "usage"].includes(state.tab) && !state.dirty) scheduleRender(ev.type === "finish");
  };
  es.onopen = () => { if (state.meta) setStatus("ok", `Running on port ${state.meta.port} · live${viewOnlyNow() ? " · view-only: this device changes nothing" : ""}`); };
  // A refusal may be this browser's own — a device revoked or signed out — and then the page goes to the pairing page.
  es.onerror = () => { setStatus("err", "Connection lost, retrying…"); void leaveIfRefused(); es.close(); letGo(); setTimeout(connectEvents, 5000); };
}

bindUi({
  state, render, go, goto, toast, api, intro, empty, schemaForm, markDirty, setReqFilter,
  REQ_FILTER_DEFAULTS, HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel, upDisplay,
  removeUpstream, routeMeaning, routeTester, modelCatalog,
  failoverRows, failoverSentence, flowDiagram, cmpTable, section, bridgeModes, BRIDGE_HINT,
  FAIL_CAUSES, STRATEGIES, qs, rx, bare, setStatus, loadAll, loadSavedAndGo,
  loadRequests, loadOps, hashFor, startLiveTicker, requestsTable,
  opsTable, mixedTable, liveView, agentsView, openRequest,
  openRulesDrawer, flatten, mergedRules, input, idInput, pingResult, memStatus, memAgo, memWhen,
  memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg, memSessionLink, memOffPanel,
  memGate, memJobPanel, memBackupsPanel, memImportPanel, memBackfillControl, memResultsTable,
  memSummary, commandsDoc, memKnewCard, memTimelineCard,
  memBenchmarkPanels, fmt, h, $, store, md, mdDoc, mdBlock, esc, setHtml, statusPill, phaseOf,
  spark, closeDrawer, openDrawer, diffView, CONFIG_TABS, getStarted, startFacts,
  isLeaf, liveRow, liveTree, onEvents, openRawMessages, putConfig, configFollow,
});
applyHash();

function boot() {
  loadAll().then(connectEvents).catch((e) => {
    setStatus("err", "Server unreachable, retrying…");
    $("#view").replaceChildren(empty("Filament is not answering", `${e.message}. This page retries every 5 seconds. If it stays down, start Filament (the Filament app's tray → Restart Filament, or run: node bin/filament.js).`));
    setTimeout(boot, 5000);
  });
}
boot();
// Anything that slipped past a handler ends up as a toast instead of a silent console line.
window.addEventListener("unhandledrejection", (e) => { console.error(e.reason); toast(`Something went wrong: ${e.reason?.message || e.reason}`, "err"); });
window.addEventListener("error", (e) => { console.error(e.error || e.message); toast(`Something went wrong: ${e.message}`, "err"); });
