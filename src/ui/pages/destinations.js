// @ts-check
import { ui } from "../runtime.js";
import { capsLoader, capChips, capLegend, sourceLong, familyWindowWords, spelledWords, fmtPrice, normPrice } from "../lib/model-caps.js";
import { openTune } from "../lib/model-tune.js";
import { providerFor, prefixRouteOf, prefixProblem, freePrefix, fieldsOf, fillUrl, placeholders, billingAt, keptHeaderWords } from "../lib/providers.js";
import { providerAdd } from "./provider-add.js";
import { listDiffers } from "../lib/cost.js";
import { supportsRows } from "../lib/agent-profile.js";
import { isAgentUp, kindOf } from "../lib/upstream-kinds.js";

/**
 * The Tune sheet in the console (ui/lib/model-tune.js): in the drawer, asking before edits Apply has not taken go, and
 * telling the configuration's follower when it closes (a save elsewhere waits while it is open).
 * @returns {import("../lib/model-tune.js").TuneKit}
 */
const tuneKit = () => {
  const { h, openDrawer, closeDrawer, configFollow } = /** @type {any} */ (ui);
  return {
    h,
    open: (title, box, g) => {
      openDrawer(title, box, { guard: () => !g.dirty() || confirm(g.discard), onClose: () => configFollow.settled() });
      return { close: (force) => { closeDrawer({ force: !!force }); } };
    },
    button: (o) => h("button", { type: "button", class: o.primary ? "primary" : "ghost", ...(o.title ? { title: o.title } : {}), ...(o.onClick ? { onclick: o.onClick } : {}) }, o.label),
  };
};

/**
 * The names a headers map puts the stored-value placeholder under that held no stored value before: a header renamed
 * with its placeholder, whose value the store would not find. @param {any} next @param {any} was
 */
const placeholderMoved = (next, was) => Object.keys(next || {}).filter((k) => next[k] === "__SECRET__" && was?.[k] !== "__SECRET__");

/**
 * What of an upstream's stored secrets this secret.key cannot open (the store's `unreadable`, by place), each by its
 * place under the upstream — `apiKey`, `headers.Authorization` — found under the id it was read with; its key only while
 * the draft keeps it (a Remove takes it out, and Save forgets it).
 * @param {string[] | undefined} unreadable @param {any} u
 */
const unreadableOf = (unreadable, u) => {
  const at = `upstreams.${u.renamedFrom ?? u.id}.`;
  return (unreadable || []).filter((where) => where.startsWith(at)).map((where) => where.slice(at.length)).filter((place) => place !== "apiKey" || u.apiKey === "__SECRET__");
};

/**
 * A card's line for its unreadable secrets: kept as sealed, so the secret.key they were sealed with opens them again.
 * @param {any} h @param {string[]} lost
 */
const unreadableNote = (h, lost) =>
  lost.length
    ? h("div", { class: "alert warn", style: "margin:0 0 10px" },
        h("span", {}, h("b", {}, "Stored, but this secret.key cannot read it: "), lost.join(", "), ". Put back the secret.key it was sealed with, beside config.json, and restart Filament to read it again. A value typed in its place replaces it, and Remove forgets it; a save of anything else keeps it."))
    : null;

export function routes() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester, modelCatalog,
    failoverRows, failoverSentence, flowDiagram, cmpTable, section,
    bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    qs, rx, bare, setStatus, loadAll, loadSavedAndGo,
    loadRequests, loadOps, hashFor, startLiveTicker,
    requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten, mergedRules,
    input, idInput, pingResult, memStatus, memAgo, memWhen,
    memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg, memSessionLink,
    memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel, memBackfillControl,
    memResultsTable, memSummary, commandsDoc,
    memKnewCard, memTimelineCard, memBenchmarkPanels, h, store, md,
    mdDoc, mdBlock, setHtml, statusPill, phaseOf, $,
    openDrawer,
  } = /** @type {any} */ (ui);


    const c = state.config;
    const ups = c.upstreams.map((u) => u.id);
    const upName = (id) => { const u = c.upstreams.find((x) => x.id === id); return u ? (u.name || u.id).replace(" (agent via ACP)", "") : `${id} (missing)`; };
    // Same matching as the server: "*" = any text, "re:" = regular expression, otherwise exact (case-insensitive).
    const matches = (pattern, model) => { if (!pattern) return null; const m = String(model || ""); if (pattern.startsWith("re:")) { try { const r = new RegExp(pattern.slice(3), "i").exec(m); return r ? r.slice(1) : null; } catch { return null; } } if (pattern === "*") return [m]; const esc = pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.*)"); const r = new RegExp(`^${esc}$`, "i").exec(m); return r ? r.slice(1) : null; };
    const renderSent = (tpl, base, caps) => (tpl && tpl.trim() ? tpl.replace(/\{model\}/g, base).replace(/\{(\d+)\}/g, (_, i) => caps[Number(i) - 1] ?? "") : base);
    // Examples use a real advertised name when one matches the route; the heuristics below are the fallback.
    if (!state._modelNames) { state._modelNames = []; modelCatalog(); } else modelCatalog();
    const exampleFor = (r) => { const u = c.upstreams.find((x) => x.id === r.upstream); const m = String(r.match ?? ""); const [pre, post = ""] = m.split("*"); if (m.startsWith("re:")) return "some-model"; if (!m.includes("*")) return m || "some-model"; const real = (state._modelNames || []).find((n) => matches(r.match, n)); if (real) return real; const cap = isAgentUp(u) ? (u.id === "cursor" ? "auto" : "some-model") : u?.type === "qoder" ? "lite" : /claude-$/i.test(pre) ? "fable-5-1" : "claude-fable-5-1"; return `${pre}${cap}${post}`; };
    // Which route (index) catches a name first, honouring order and the on/off switch.
    const firstCatch = (name) => { for (let i = 0; i < c.routes.length; i++) { const r = c.routes[i]; if (r.enabled === false) continue; if (matches(r.match, name)) return i; } return -1; };

    // ---- route editor: plain-language form in the drawer, edits the draft live ----
    const openRouteEditor = (r) => {
      const body = h("div", { class: "route-editor" });
      const draw = () => {
        const u = c.upstreams.find((x) => x.id === r.upstream); const hasStar = String(r.match || "").includes("*"); const isRe = String(r.match || "").startsWith("re:");
        const mode = isRe ? "pattern" : r.match === "*" ? "all" : hasStar && r.match.endsWith("*") && r.match.indexOf("*") === r.match.length - 1 ? "prefix" : hasStar ? "pattern" : "exact";
        const ex = exampleFor(r); const caps = matches(r.match, ex) || []; const sent = renderSent(r.upstreamModel, ex, caps);
        const radio = (name, value, current, label, sub, onpick) => { const inp = h("input", { type: "radio", name, value }); inp.checked = value === current; inp.onchange = () => { onpick(); markDirty(); render(); draw(); }; return h("label", { class: `opt ${value === current ? "picked" : ""}` }, inp, h("span", {}, h("b", {}, label), sub ? h("span", { class: "muted small" }, sub) : null)); };
        const textIn = (val, placeholder, on, cls = "mono") => { const i = h("input", { type: "text", class: cls, value: val ?? "", placeholder }); i.oninput = () => { on(i.value); markDirty(); }; i.onchange = () => { render(); draw(); }; return i; };
        // step 1: names
        const prefixVal = mode === "prefix" ? r.match.slice(0, -1) : "";
        const step1 = h("section", { class: "step-box" }, h("h3", {}, "1. Which names should this route catch?"), h("p", { class: "muted small" }, "The model name your agent types or picks. Effort suffixes like -xhigh and mode suffixes like @plan are removed before matching, so you never need to include them."),
          h("div", { class: "opts" },
            radio("m", "prefix", mode, "Names that start with…", "the usual choice: one route for a whole family, e.g. everything starting with cursor/", () => { const kept = String(r.match || "").replace(/^re:/, "").split("*")[0]; r.match = (kept || (isAgentUp(u) ? `${u.id}/` : "claude-")) + "*"; }),
            radio("m", "exact", mode, "One exact name", "a nickname you invent, e.g. fast, that maps to one model", () => { const kept = String(r.match || "").replace(/^re:/, "").replace(/\*/g, ""); r.match = kept || "my-model"; }),
            radio("m", "all", mode, "Every name", "a catch-all; put it last, it swallows everything the routes above it did not", () => { r.match = "*"; }),
            radio("m", "pattern", mode, "Custom pattern", "* anywhere means “any text”; re: starts a regular expression", () => { if (!hasStar) r.match = r.match + "-*"; })),
          mode === "prefix" ? h("div", { class: "row", style: "margin:8px 0 0" }, h("label", { class: "grow" }, "names start with", textIn(prefixVal, "cursor/", (v) => { r.match = v + "*"; }))) : null,
          mode === "exact" ? h("div", { class: "row", style: "margin:8px 0 0" }, h("label", { class: "grow" }, "the exact name", textIn(r.match, "fast", (v) => { r.match = v; }))) : null,
          mode === "pattern" ? h("div", { class: "row", style: "margin:8px 0 0" }, h("label", { class: "grow" }, "pattern", textIn(r.match, "claude-*-preview", (v) => { r.match = v; }))) : null,
          h("p", { class: "small live-line" }, r.match ? h("span", {}, "Catches for example ", h("code", {}, ex), mode === "prefix" ? h("span", {}, " and anything else starting with ", h("code", {}, prefixVal)) : null, ".") : h("span", { class: "warn" }, "Type something above.")));
        // step 2: upstream
        const sel = h("select", {}, ...c.upstreams.map((x) => h("option", { value: x.id, selected: x.id === r.upstream ? "" : null }, `${x.name || x.id}  ·  ${kindOf(x)}${x.enabled === false ? "  (disabled)" : ""}`))); sel.onchange = () => { r.upstream = sel.value; markDirty(); render(); draw(); };
        const step2 = h("section", { class: "step-box" }, h("h3", {}, "2. Where should they go first?"), h("p", { class: "muted small" }, "The provider tried first. Backups, and the order they are tried in, come in step 4."), h("div", { class: "row", style: "margin:6px 0 0" }, h("label", { class: "grow" }, "upstream", sel)), u ? h("p", { class: "muted small" }, isAgentUp(u) ? `${upName(u.id)} is a coding agent: it edits files and runs commands itself, in the project folder your client is working in.` : u.type === "qoder" ? "Qoder cloud: plain chat models on your Qoder account and credits." : `A ${kindOf(u)} server${u.baseUrl ? ` at ${u.baseUrl}` : ""}.`) : h("p", { class: "warn small" }, "This upstream no longer exists. Pick another."));
        // step 3: name sent
        const tpl = r.upstreamModel || "{model}"; const nmode = tpl === "{model}" ? "same" : tpl === "{1}" ? "after" : /\{(model|\d+)\}/.test(tpl) ? "template" : "fixed";
        const step3 = h("section", { class: "step-box" }, h("h3", {}, `3. What name should ${u ? upName(u.id) : "the upstream"} receive?`), h("p", { class: "muted small" }, "Upstreams only know their own names. This turns the name your agent used into the one the upstream understands."),
          h("div", { class: "opts" },
            hasStar ? radio("n", "after", nmode, "Only the part after the prefix", `${ex} → ${caps[0] ?? ""}  (written {1})`, () => { r.upstreamModel = "{1}"; }) : null,
            radio("n", "same", nmode, "The same name, unchanged", `${ex} → ${ex}  (written {model})`, () => { r.upstreamModel = "{model}"; }),
            radio("n", "fixed", nmode, "Always one fixed name", "whatever the agent asked for, the upstream gets this model", () => { r.upstreamModel = nmode === "fixed" ? tpl : (isAgentUp(u) ? "auto" : "claude-sonnet-5"); }),
            radio("n", "template", nmode, "Custom template", "{model} = the whole name, {1} = what the first * matched; text around them is kept", () => { r.upstreamModel = nmode === "template" ? tpl : "anthropic/{model}"; })),
          nmode === "fixed" || nmode === "template" ? h("div", { class: "row", style: "margin:8px 0 0" }, h("label", { class: "grow" }, nmode === "fixed" ? "model name" : "template", textIn(tpl, nmode === "fixed" ? "claude-sonnet-5" : "anthropic/{model}", (v) => { r.upstreamModel = v; }))) : null,
          h("p", { class: "small live-line" }, "Result: your agent asks for ", h("code", {}, ex), " → ", h("b", {}, u ? upName(u.id) : "?"), " receives ", h("code", {}, sent), "."));
        // step 4: try it
        const tryIn = h("input", { type: "text", class: "mono", placeholder: ex, value: state._routeTry || ex }); const tryOut = h("div", { class: "small", style: "margin-top:6px" });
        const runTry = () => { const name = tryIn.value.trim(); state._routeTry = name; if (!name) return tryOut.replaceChildren(); const base = name.replace(/@.*$/, "").replace(/-(low|medium|high|xhigh|max)(-fast)?$/i, "").replace(/-fast$/i, ""); const idx = firstCatch(base); const mine = c.routes.indexOf(r); const cp = matches(r.match, base);
          if (idx === mine) tryOut.replaceChildren(h("span", { class: "pill ok" }, "caught by this route"), " ", h("span", {}, `${u ? upName(u.id) : "?"} receives `, h("code", {}, renderSent(r.upstreamModel, base, cp || []))));
          else if (cp && idx >= 0) tryOut.replaceChildren(h("span", { class: "pill warn" }, `caught by row ${idx + 1} first`), " ", h("span", {}, `Route “${c.routes[idx].match}” is above this one and also matches, so it wins. Move this route up if you want it to catch ${base}.`));
          else if (cp) tryOut.replaceChildren(h("span", { class: "pill warn" }, "this route is switched off"));
          else if (idx >= 0) tryOut.replaceChildren(h("span", { class: "pill" }, `not this route; row ${idx + 1} (${c.routes[idx].match}) catches it`));
          else tryOut.replaceChildren(h("span", { class: "pill err" }, "no route catches this name"), " ", h("span", { class: "muted" }, "the agent would get “no route matches model”.")); };
        tryIn.oninput = runTry; setTimeout(runTry, 0);
        const step4 = h("section", { class: "step-box" }, h("h3", {}, "5. Try a name"), h("p", { class: "muted small" }, "Type what your agent would send and see what happens, including whether a route higher in the list catches it first."), tryIn, tryOut);
        // failover order: row 1 is the primary (the same upstream and template as steps 2 and 3), rows 2..n the backups, tried top to bottom
        const failoverOn = c.rules?.resilience?.failover === true;
        const chainGet = () => [{ upstream: r.upstream, upstreamModel: r.upstreamModel || "{model}" }, ...(r.fallbacks || [])];
        const chainSet = (arr) => { const [first, ...rest] = arr; r.upstream = first?.upstream || ""; r.upstreamModel = first?.upstreamModel ?? "{model}"; r.fallbacks = rest; };
        const foSent = h("p", { class: "small live-line" });
        const foLive = () => foSent.replaceChildren(failoverSentence(ex, chainGet(), r.strategy, { sentFor: (tpl) => renderSent(tpl, ex, caps) }));
        foLive();
        const strat = h("select", {}, ...STRATEGIES.map(([v, l, sub]) => h("option", { value: v, selected: v === (r.strategy || "in_order") ? "" : null }, `${l}: ${sub}`))); strat.onchange = () => { r.strategy = strat.value; markDirty(); render(); draw(); };
        const turnOn = h("button", { class: "sm primary", onclick: async () => { try { await ui.configFollow.own(async () => ui.configFollow.adopt((await api("/failover", { method: "POST", body: { enabled: true } })).version)); for (const cfgObj of [state.config, state.saved]) if (cfgObj) ((cfgObj.rules ||= {}).resilience ||= {}).failover = true; toast("Failover on: the next provider takes over when one fails"); render(); draw(); } catch (/** @type {any} */ e) { toast(e.message, "err"); } } }, "Turn on");
        const failover = h("section", { class: "step-box fo-box" }, h("h3", {}, "4. Failover order"),
          h("p", { class: "muted small" }, "Row 1 is where requests go first. When it fails (", FAIL_CAUSES, ") the next row is tried, and so on down the list. Each row names a provider and the model it should receive: the list offers the names that provider advertises, and ", h("code", {}, "{model}"), " means “the same name the client asked for”."),
          failoverOn ? null : h("div", { class: "alert warn", style: "margin:6px 0 10px" }, h("span", {}, h("b", {}, "Failover is switched off"), " (the switch on the Home page), so only row 1 is used and the rows below it are ignored."), h("span", { class: "grow" }), turnOn),
          failoverRows({ get: chainGet, set: chainSet, redraw: () => { render(); draw(); }, live: foLive, onEdit: () => markDirty(), minRows: 1 }),
          foSent,
          (r.fallbacks || []).length ? h("div", { class: "row", style: "margin:10px 0 0" }, h("label", { class: "grow" }, "how to choose among the rows", strat)) : null,
          (r.fallbacks || []).length ? h("p", { class: "muted small", style: "margin:4px 0 0" }, "Only “Priority order” is a strict order. The other strategies spread requests over the whole list and still move to another row when the chosen one fails.") : null);
        const fmt = h("select", {}, ...[["auto", "auto: accept both shapes (recommended)"], ["anthropic", "anthropic only"], ["openai", "openai only"]].map(([v, l]) => h("option", { value: v, selected: v === (r.format || "auto") ? "" : null }, l))); fmt.onchange = () => { r.format = fmt.value; markDirty(); render(); };
        const isRouter = u && (u.type === "openai-compatible" || u.type === "anthropic-compatible");
        const adv = h("details", { class: "subform", open: (r.format && r.format !== "auto") || (r.discoverPrefixes || []).length || Object.keys(flatten(r.rules || {})).length ? "" : null }, h("summary", {}, "Advanced (format, discovery, rule overrides)"), h("div", { style: "padding:10px 14px" },
          h("div", { class: "row" }, h("label", { class: "grow" }, "request format the agent may use", fmt)), h("p", { class: "muted small" }, "auto lets Anthropic-style and OpenAI-style clients both use this route; Filament translates when the upstream speaks the other one."),
          isRouter ? h("div", { class: "row" }, h("label", { class: "grow" }, "advertise the router's models listed under these provider prefixes by their bare name (comma separated)", textIn((r.discoverPrefixes || []).join(", "), "anthropic", (v) => { r.discoverPrefixes = v.split(",").map((s) => s.trim()).filter(Boolean); }, ""))) : null,
          h("div", { class: "row" }, h("button", { onclick: () => openRulesDrawer(`Route ${r.match}: rule overrides`, r.rules || (r.rules = {}), mergedRules(c.rules, u?.rules), `Only this route (${r.match})`) }, `rule overrides for this route${Object.keys(flatten(r.rules || {})).length ? ` (${Object.keys(flatten(r.rules || {})).length} set)` : ""}`), h("span", { class: "muted small" }, "e.g. a lower effort cap or forced streaming only for names caught here"))));
        body.replaceChildren(h("p", { class: "muted small", style: "margin:0 0 12px" }, "Changes apply to the table immediately; press Save changes at the top when you are done."), step1, step2, step3, failover, step4, adv, h("div", { class: "row", style: "margin-top:14px" }, h("button", { class: "primary", onclick: () => $("#drawer").classList.add("hidden") }, "Done"), h("button", { class: "danger", onclick: () => { c.routes.splice(c.routes.indexOf(r), 1); markDirty(); render(); $("#drawer").classList.add("hidden"); } }, "Delete this route")));
      };
      draw(); openDrawer("Edit route", body);
    };

    // ---- the table: one plain row per route, edited through the editor ----
    // A provider's own prefix route (Providers D1) is made, edited and removed with the provider: read-only here.
    const madeBy = (r) => c.upstreams.find((x) => x.id === r.upstream && prefixRouteOf(c, x.id) === r) || null;
    const openProvider = (u) => { state.selUp = u.id; state.addUp = false; go("upstreams"); };
    const providerNote = (u) => h("div", { class: "muted small made-by" }, `made by provider ${u.name || u.id}: `, h("a", { href: "#destinations:upstreams", class: "golink", onclick: (e) => { e.preventDefault(); openProvider(u); } }, "edit its prefix on the provider"));
    const rows = c.routes.map((r, i) => {
      const u = c.upstreams.find((x) => x.id === r.upstream); const ex = exampleFor(r); const caps = matches(r.match, ex) || []; const sent = renderSent(r.upstreamModel, ex, caps);
      const shadow = r.enabled !== false && r.match ? firstCatch(ex) : i; const shadowed = shadow >= 0 && shadow !== i;
      const owner = madeBy(r);
      const on = h("input", { type: "checkbox", title: owner ? "a provider's prefix route: switch the provider off on its card" : "on / off", disabled: owner ? "" : null }); on.checked = r.enabled !== false; on.onchange = () => { r.enabled = on.checked; markDirty(); render(); };
      const extras = [];
      if ((r.fallbacks || []).length) { const sl = STRATEGIES.find((s) => s[0] === (r.strategy || "in_order")); extras.push(h("span", { class: "pill fo", title: [{ upstream: r.upstream, upstreamModel: r.upstreamModel }, ...r.fallbacks].map((f, k) => `${k + 1}. ${upName(f.upstream)} receives ${f.upstreamModel || "{model}"}`).join("\n") }, `failover${r.strategy && r.strategy !== "in_order" ? ` · ${(sl?.[1] || r.strategy).toLowerCase()}` : ""}`)); }
      if (r.format && r.format !== "auto") extras.push(h("span", { class: "pill" }, `${r.format} clients only`));
      if ((r.discoverPrefixes || []).length) extras.push(h("span", { class: "pill", title: "discover prefixes" }, `advertises ${r.discoverPrefixes.join(", ")}/*`));
      const ov = Object.keys(flatten(r.rules || {})).length; if (ov) extras.push(h("span", { class: "pill", title: Object.keys(flatten(r.rules)).join("\n") }, `${ov} rule override${ov === 1 ? "" : "s"}`));
      const matchCell = h("td", {}, h("div", {}, h("code", {}, r.match || "(empty)")), h("div", { class: "muted small" }, !r.match ? "nothing yet" : r.match === "*" ? "every name (catch-all)" : r.match.includes("*") ? `e.g. ${ex}` : "exactly this name"), owner ? providerNote(owner) : null);
      return [h("tr", { class: `${r.enabled === false ? "off-row" : ""}${owner ? " provider-route" : ""}` },
        h("td", { class: "num muted" }, i + 1), h("td", {}, on), matchCell,
        h("td", {}, h("b", {}, u ? upName(u.id) : `${r.upstream} (missing)`), h("div", { class: "muted small" }, kindOf(u)), (r.fallbacks || []).length ? h("div", { class: "small chain", title: r.strategy && r.strategy !== "in_order" ? "spread over these providers" : "tried in this order when one fails" }, [r.upstream, ...r.fallbacks.map((f) => f.upstream)].map(upName).join(" → ")) : null),
        h("td", {}, (() => { const tpl = r.upstreamModel || "{model}"; const same = sent === ex; const words = tpl === "{1}" ? "the part after the prefix" : tpl === "{model}" || same ? "the same name" : /\{/.test(tpl) ? "the name rewritten" : "always this one name"; return [h("div", {}, words, /\{/.test(tpl) && tpl !== "{model}" && tpl !== "{1}" ? h("span", { class: "muted small" }, same ? ` (template ${tpl} changes nothing here)` : ` (template ${tpl})`) : null), h("div", { class: "muted small mono", title: "example: what your client asks for → what this provider is asked for" }, same && !/\{/.test(tpl) ? h("code", {}, sent) : h("span", {}, "e.g. ", h("code", {}, ex || r.match), " → ", h("code", {}, sent)))]; })()),
        h("td", {}, ...extras, shadowed ? h("span", { class: "pill warn", title: `Row ${shadow + 1} (${c.routes[shadow].match}) is higher and also matches these names, so it always wins.` }, `never reached: row ${shadow + 1} wins`) : null),
        owner ? h("td", { class: "actions-cell" }, h("button", { class: "sm", title: "Its prefix, and whether it is on, are set on the provider's card", onclick: () => openProvider(owner) }, "Provider")) : h("td", { class: "actions-cell" }, h("button", { class: "sm primary", onclick: () => openRouteEditor(r) }, "Edit"), h("button", { class: "icon", title: "move up (routes are checked top to bottom)", onclick: () => { if (i > 0) { [c.routes[i - 1], c.routes[i]] = [c.routes[i], c.routes[i - 1]]; markDirty(); render(); } } }, "↑"), h("button", { class: "icon", title: "move down", onclick: () => { if (i < c.routes.length - 1) { [c.routes[i + 1], c.routes[i]] = [c.routes[i], c.routes[i + 1]]; markDirty(); render(); } } }, "↓"))),
        h("tr", { class: "meaning-row" }, h("td", { class: "meaning", colspan: 7 }, r.match ? routeMeaning(r, c, { ex, sent }) : "Press Edit and choose which names this route should catch."))];
    }).flat();
    const table = h("table", { class: "routes-table" }, h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "on"), h("th", {}, "names your agent asks for"), h("th", {}, "go to"), h("th", {}, "the provider gets"), h("th", {}, "extras"), h("th", {}, ""))), h("tbody", {}, ...rows));

    const add = h("button", { onclick: () => { const r = { match: "", upstream: ups[0] || "", upstreamModel: "{model}", format: "auto", fallbacks: [], enabled: true, rules: {} }; c.routes.push(r); markDirty(); render(); openRouteEditor(r); } }, "+ New route");
    // Ready-made routes per upstream: the shapes that work for each kind, so nobody has to invent placeholders.
    const suggestions = c.upstreams.flatMap((u) => {
      const id = u.id; if (!id) return [];
      if (isAgentUp(u)) { const pre = id.replace(/[^a-z0-9]+/gi, "").toLowerCase(); return [[`${upName(id)}: names starting with ${pre}/ → the agent gets the part after it`, { match: `${pre}/*`, upstream: id, upstreamModel: "{1}" }]]; }
      if (u.type === "qoder") return [[`${upName(id)}: names starting with qd/ → Qoder gets the part after it`, { match: "qd/*", upstream: id, upstreamModel: "{1}" }]];
      if (u.type === "anthropic" || u.type === "anthropic-compatible") return [[`${upName(id)}: names starting with direct/claude- → Anthropic gets claude-…`, { match: "direct/claude-*", upstream: id, upstreamModel: "claude-{1}" }], [`${upName(id)}: names starting with claude- → sent unchanged`, { match: "claude-*", upstream: id, upstreamModel: "{model}" }]];
      return [[`${upName(id)}: every other name → sent unchanged (catch-all, goes last)`, { match: "*", upstream: id, upstreamModel: "{model}" }]];
    });
    const quick = h("select", {}, h("option", { value: "" }, "+ Add a ready-made route…"), ...suggestions.map(([label], i) => h("option", { value: String(i) }, label)));
    quick.onchange = () => { const pick = suggestions[Number(quick.value)]; if (!pick) return; const r = { format: "auto", fallbacks: [], discoverPrefixes: [], enabled: true, rules: {}, ...pick[1] }; if (r.match === "*") c.routes.push(r); else c.routes.unshift(r); markDirty(); render(); toast(`Added ${r.match}; press Save changes to use it`); };

    if (state.section && /^edit-\d+$/.test(state.section)) { const r = c.routes[Number(state.section.slice(5))]; state.section = null; const owner = r ? madeBy(r) : null; if (owner) setTimeout(() => openProvider(owner), 0); else if (r) setTimeout(() => openRouteEditor(r), 0); }
    // ---- virtual model builder: one plain name, several providers in order; lives in state.vm until Create or Cancel ----
    const freshVm = () => { const first = c.upstreams.find((u) => u.enabled !== false && !isAgentUp(u)) || c.upstreams.find((u) => u.enabled !== false) || c.upstreams[0]; return { name: c.routes.some((r) => r.match === "free-model") ? "" : "free-model", chain: [{ upstream: first?.id || "", upstreamModel: "" }] }; };
    if (state.section === "new-virtual") { state.section = null; state.vmOpen = true; state.vm ||= freshVm(); setTimeout(() => document.getElementById("routes-new-virtual")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
    const vmPanel = () => {
      const V = (state.vm ||= freshVm());
      const nameError = (n) => !n ? "Type a name." : /\s/.test(n) ? "No spaces in the name." : n.includes("*") ? "No * here: a virtual model is one exact name." : /^re:/i.test(n) ? "The name must not start with re:." : c.routes.some((r) => String(r.match || "").toLowerCase() === n.toLowerCase()) ? "A route with exactly this name already exists." : "";
      const rowError = () => { if (!V.chain.length) return "Add at least one provider."; const bad = V.chain.findIndex((x) => !x.upstream || !String(x.upstreamModel || "").trim()); if (bad >= 0) return `Row ${bad + 1} needs a model name: pick one from the list.`; const tpl = V.chain.findIndex((x) => /\{(model|\d+)\}/.test(x.upstreamModel)); if (tpl >= 0) return `Row ${tpl + 1} would send the name ${V.name || "free-model"} itself to the provider; pick a real model.`; return ""; };
      const shownName = () => V.name || "free-model";
      const sent = h("p", { class: "small live-line" });
      const errEl = h("div", { class: "warn small", style: "margin:4px 0 0" });
      const create = h("button", { class: "primary" }, "Create");
      const live = () => { sent.replaceChildren(failoverSentence(shownName(), V.chain, "in_order", { sentFor: (tpl) => tpl.replace(/\{model\}/g, shownName()) })); const err = nameError(V.name) || rowError(); errEl.textContent = err; create.disabled = !!err; };
      const nameIn = h("input", { type: "text", class: "mono", value: V.name, placeholder: "free-model", autocomplete: "off", spellcheck: "false" });
      nameIn.oninput = () => { V.name = nameIn.value.trim(); live(); };
      create.onclick = () => { if (nameError(V.name) || rowError()) return live(); const [first, ...rest] = V.chain; c.routes.unshift({ match: V.name, upstream: first.upstream, upstreamModel: String(first.upstreamModel).trim(), fallbacks: rest.map((x) => ({ upstream: x.upstream, upstreamModel: String(x.upstreamModel).trim() })), strategy: "in_order", format: "auto", enabled: true, rules: {} }); markDirty(); state.vmOpen = false; state.vm = null; toast(`${V.name} created at the top of the table; press Save changes to use it`); render(); };
      live();
      return h("section", { class: "vm-box", id: "routes-new-virtual" },
        h("div", { class: "row", style: "margin:0 0 4px;align-items:center" }, h("h3", { style: "margin:0" }, "New virtual model"), h("span", { class: "grow" }), h("button", { class: "sm ghost", onclick: () => { state.vmOpen = false; render(); } }, "Cancel")),
        h("p", { class: "muted small" }, "A model name you invent. Any client can ask for it, and Memory can take it as its model. Behind the scenes Filament tries the providers below in order: row 1 first, then row 2 when it fails (", FAIL_CAUSES, "), and so on."),
        h("div", { class: "row", style: "margin:8px 0 0" }, h("label", { class: "grow" }, "name clients will ask for (no spaces, no *)", nameIn)),
        h("h4", { style: "margin:12px 0 0" }, "Providers, in the order they are tried"),
        h("p", { class: "muted small", style: "margin:2px 0 0" }, "Pick a provider, then a model from its list (type to filter). Free models from several providers make a good ", h("code", {}, "free-model"), "."),
        failoverRows({ get: () => V.chain, set: (arr) => { V.chain = arr; }, redraw: render, live, onEdit: null, minRows: 1, defaultModel: "", placeholder: "pick a model from the list" }),
        sent, errEl,
        h("div", { class: "row", style: "margin:12px 0 0;align-items:center" }, create, h("span", { class: "muted small" }, "Creates a route at the top of the table (an exact name must sit above the wildcard rows). Once saved, ", h("code", {}, shownName()), " works in every client that points at Filament and as the Memory cheap model.")));
    };
    const vmBtn = h("button", { class: `sm${state.vmOpen ? "" : " primary"}`, title: "One name of your own that tries several providers in order", onclick: () => { state.vmOpen = !state.vmOpen; if (state.vmOpen) state.vm ||= freshVm(); render(); } }, state.vmOpen ? "Close virtual model" : "New virtual model");
    // The same routes seen from the destinations: which names reach each one, with a one-click route for those that have none.
    const RV = state.routesView || store.get("routes.view") || "names";
    const viewSeg = h("div", { class: "seg" }, ...[["names", "By name"], ["providers", "By provider"]].map(([v, l]) => h("button", { class: v === RV ? "active" : "", onclick: () => { state.routesView = v; store.set("routes.view", v); render(); } }, l)));
    const providerView = () => h("div", { class: "prov-cards" }, ...[...c.upstreams].sort((a, b) => Number(a.enabled === false) - Number(b.enabled === false)).map((u) => {
      const mine = c.routes.map((r, i) => ({ r, i })).filter(({ r }) => r.upstream === u.id);
      const backupFor = c.routes.filter((r) => (r.fallbacks || []).some((f) => f.upstream === u.id));
      const sug = suggestions.filter(([, r]) => r.upstream === u.id);
      const addFor = () => { const base = sug[0]?.[1] || { match: "", upstream: u.id, upstreamModel: "{model}" }; const r = { format: "auto", fallbacks: [], discoverPrefixes: [], enabled: true, rules: {}, ...base }; if (c.routes.some((x) => x.match === r.match && x.upstream === r.upstream)) r.match = ""; if (r.match === "*") c.routes.push(r); else c.routes.unshift(r); markDirty(); render(); openRouteEditor(r); };
      return h("div", { class: `card prov-card${u.enabled === false ? " off" : ""}` },
        h("div", { class: "row", style: "margin:0 0 6px;align-items:center;gap:8px" }, h("b", {}, upName(u.id)), h("span", { class: "pill" }, kindOf(u)), u.enabled === false ? h("span", { class: "pill warn" }, "disabled") : null, h("span", { class: "grow" }), h("button", { class: "sm", title: "Add a route that sends names to this destination", onclick: addFor }, "+ route")),
        mine.length ? h("table", { class: "small prov-routes" }, h("tbody", {}, ...mine.map(({ r, i }) => { const ex = exampleFor(r); const caps = matches(r.match, ex) || []; const sent = renderSent(r.upstreamModel, ex, caps); const shadow = r.enabled !== false && r.match ? firstCatch(ex) : i; const shadowed = shadow >= 0 && shadow !== i;
          return h("tr", { class: r.enabled === false ? "off-row" : "" }, h("td", { class: "num muted", title: "row in the table; lower rows are checked later" }, i + 1), h("td", {}, h("code", {}, r.match || "(empty)"), h("div", { class: "muted small" }, !r.match ? "nothing yet" : r.match === "*" ? "every name" : r.match.includes("*") ? `e.g. ${ex}` : "exactly this name")), h("td", {}, h("span", { class: "muted" }, "receives "), h("code", {}, sent)), h("td", {}, (r.fallbacks || []).length ? h("span", { class: "pill fo", title: [r.upstream, ...r.fallbacks.map((f) => f.upstream)].map(upName).join(" → ") }, "failover") : null, r.enabled === false ? h("span", { class: "pill" }, "off") : null, shadowed ? h("span", { class: "pill warn" }, `never reached: row ${shadow + 1} wins`) : null), h("td", { class: "actions-cell" }, madeBy(r) ? h("button", { class: "sm", title: "its prefix route: set on the provider's card", onclick: () => openProvider(u) }, "Provider") : h("button", { class: "sm primary", onclick: () => openRouteEditor(r) }, "Edit"))); }))) : h("p", { class: "muted small", style: "margin:4px 0" }, "No route reaches this destination yet. Press + route."),
        backupFor.length ? h("div", { class: "muted small", style: "margin-top:6px" }, `Also a backup for ${backupFor.map((r) => r.match).join(", ")}.`) : null);
    }));
    const flowBox = (title, sub, cls = "") => h("div", { class: `flow-box ${cls}` }, h("b", {}, title), h("span", { class: "small muted" }, sub));
    return h("div", {},
      intro("routes",
        h("p", {}, h("b", {}, "You need this page for bare names, rewrites, failover and virtual models. "), "Each provider's own prefix route (", h("code", {}, "zai/*"), " → Z.AI) is made, edited and removed with the provider on the Upstreams page, and shown here read-only."),
        h("p", {}, "A route is one sentence: ", h("b", {}, "when my agent asks for a name like this, send it to that upstream and call it this over there"), ". That is all the table below says, one row per sentence."),
        h("div", { class: "flow" }, flowBox("Your agent asks for", "cursor/auto", ""), h("div", { class: "flow-arrow" }, "→", h("small", {}, "first matching row wins")), flowBox("Route", "names starting with cursor/ → Cursor", "flow-shim"), h("div", { class: "flow-arrow" }, "→", h("small", {}, "renamed")), flowBox("Cursor receives", "auto", "flow-up")),
        h("ul", { class: "small", style: "margin-top:10px" },
          h("li", {}, "Rows are checked ", h("b", {}, "top to bottom"), "; the first one that matches wins. A catch-all row belongs at the bottom. Rows that can never win are flagged."),
          h("li", {}, "Press ", h("b", {}, "Edit"), " on a row: the editor asks four plain questions and shows the result with a real example as you go. You can also type any name there to see which row catches it."),
          h("li", {}, "Effort and mode suffixes (", h("code", {}, "-xhigh"), ", ", h("code", {}, "@plan"), ") are removed before matching, so a route for ", h("code", {}, "claude-*"), " also catches ", h("code", {}, "claude-opus-5-xhigh"), "."),
          h("li", {}, h("b", {}, "Failover order"), ": step 4 of the editor lists the providers to try, top to bottom: row 1 first, row 2 when it fails, and so on. ", h("b", {}, "New virtual model"), " creates a name of your own, e.g. ", h("code", {}, "free-model"), ", that chains several providers behind the scenes; every client and the Memory cheap model can use it.")),
        h("details", { class: "subform", style: "margin-top:12px" }, h("summary", {}, "Reference: every field, allowed values, examples"),
          h("div", { style: "padding:10px 14px" }, cmpTable(["Field", "What it means", "Allowed values", "Examples"], [
            ["names your agent asks for (match)", "The model name your agent will type or pick, or a pattern for many names.", "An exact name (`fast`); a prefix pattern (`cursor/*`, `claude-*`); `*` alone for everything (keep it last); `re:` + regular expression for rare cases.", "`cursor/*` catches `cursor/auto` and `cursor/cursor-grok-4.6-fast`."],
            ["go to (upstream)", "Where matching requests are sent.", "One of your upstreams.", "`anthropic`, `cursor`, `qoder-cloud`"],
            ["the provider gets (upstreamModel)", "The model name the provider is asked for, shown with an example: what your client asked for → what the provider gets.", "`{model}` = the whole matched name; `{1}` = the part the first `*` matched; a fixed name; or a template mixing text with those.", "`cursor/*` + `{1}`: `cursor/auto` → `auto`. `claude-*` + `anthropic/{model}`: `claude-opus-5` → `anthropic/claude-opus-5`."],
            ["failover order (fallbacks)", "The providers tried after the first one, in order.", "Rows of upstream + model template. Used when the row above fails (rate limit, outage, unreachable, unknown model, bad key), or spread by the chosen strategy.", "`anthropic` receives `{model}`; a virtual model `free-model` → xAI `grok-4.6`, then Groq `llama-3.3-70b`"],
            ["strategy", "How to pick among the first upstream and its backups.", "only when the first fails (default); take turns; random; fastest lately; cheapest; most quota left. Cooling-down upstreams always go last.", "two Anthropic keys → take turns"],
            ["format", "Which request shape the agent may use on this route.", "auto (both, translated as needed); anthropic only; openai only.", "leave on auto"],
            ["discover prefixes", "Servers that list models as `provider/model` (OpenRouter, LiteLLM, local routers).", "Provider prefixes whose models the server lists as `prefix/xyz` and this route advertises as plain `xyz`.", "`anthropic`"],
            ["rule overrides", "Rule values that apply only to names caught by this route.", "Any field from the Rules page.", "cap effort at high on a cheap route"],
          ])))),
      h("section", { class: "panel" }, h("div", { class: "row", style: "margin:0 0 6px;align-items:center" }, h("h2", { style: "margin:0" }, RV === "providers" ? "Routes by destination" : "Route table"), h("span", { class: "grow" }), vmBtn, viewSeg),
        h("p", { class: "muted small" }, RV === "providers" ? "Each destination with the names that reach it. Order still matters: the number is the row in the table, and rows are checked top to bottom." : "Checked top to bottom. Edit a row to change it; press Save changes when done. Unsaved rows are not used for traffic yet."),
        state.vmOpen ? vmPanel() : null,
        RV === "providers" ? providerView() : c.routes.length ? h("div", { class: "table-wrap" }, table) : empty("No routes yet", "Add a ready-made one below, or press New route."), h("div", { class: "toolbar wrap", style: "margin-top:12px" }, quick, add)),
      h("section", { class: "panel" }, h("h2", {}, "Which row catches a name?"), h("p", { class: "muted small" }, "Uses the saved routes on the server, exactly as a real request would. Type what an agent would send and press Test."), routeTester()));
}

export function upstreams() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester, modelCatalog,
    failoverRows, failoverSentence, flowDiagram, cmpTable, section,
    bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    qs, rx, bare, setStatus, loadAll, loadSavedAndGo,
    loadRequests, loadOps, hashFor, startLiveTicker,
    requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten, mergedRules,
    input, idInput, pingResult, memStatus, memAgo, memWhen,
    memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg, memSessionLink,
    memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel, memBackfillControl,
    memResultsTable, memSummary, commandsDoc,
    memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h, $,
    store, md, mdDoc, mdBlock, esc, setHtml,
    statusPill, phaseOf, openDrawer, closeDrawer, putConfig,
  } = /** @type {any} */ (ui);


    const c = state.config, types = state.schema.upstreamTypes;
    const list = h("div", { class: "conn-detail" });
    // One /api/models fetch shared by every card on this render (served from the persisted cache, so it is quick).
    let modelsP = null; const models = (refresh) => (refresh || !modelsP ? (modelsP = api(`/models${refresh ? "?refresh=1" : ""}`)) : modelsP);
    // Per-agent cheat sheet: everything the agent offers (asked live) plus the facts discovery cannot tell, phrased as
    // "you want → do this" with copyable model names that use this upstream's real route prefix.
    // The Cursor SDK card: is the SDK installed, where the key comes from, what to type, how it differs from the CLI route.
// Its install has no clock (HarnessV3-FailurePoints FP-D3), so the card shows it while it runs — this page's own, or
// one the status says is under way (a reload, another window): how long, its output's newest lines as the status
// says them each second, and a Stop (POST /sdk/install/stop). Install is greyed meanwhile: a second answers 409.
// One the person stopped says so, and is no failure (HarnessV4_Tasks U1).
const sdkPanel = (u) => {
  const box = h("div", { class: "panel sub" }); const prefix = (state.config.routes || []).find((rt) => rt.upstream === u.id && rt.enabled !== false)?.match?.replace(/\*.*$/, "") || `${u.id}/`;
  let st = /** @type {any} */ (null), result = /** @type {any} */ (null), mine = false, stopping = false, timer = /** @type {any} */ (0);
  const running = () => mine || !!st?.installing;
  const watch = () => { if (!timer && running()) timer = setTimeout(poll, 1000); };
  const poll = async () => { timer = 0; if (!box.isConnected || !running()) return; try { const now = await api("/sdk/status"); if (running()) st = now; } catch { /* the next look asks again */ } if (!running()) stopping = false; draw(); watch(); };
  const install = async () => { mine = true; result = null; draw(); watch(); try { const r = await api("/sdk/install", { method: "POST", body: {} }); st = r.status; result = r; toast(r.stopped ? "Cursor SDK install stopped" : r.ok ? `Cursor SDK ${r.status.version || ""} installed` : "Install did not finish; see the output below", r.ok || r.stopped ? "ok" : "err"); } catch (/** @type {any} */ e) { result = { ok: false, output: e.message }; } mine = false; stopping = false; draw(); };
  const stop = async () => { stopping = true; draw(); try { const r = await api("/sdk/install/stop", { method: "POST" }); if (!r?.stopped) { stopping = false; toast("It had ended already"); } } catch (/** @type {any} */ e) { stopping = false; toast(e.message, "err"); } draw(); };
  const draw = () => {
    const installed = !!st?.installed, busy = running(), live = st?.installing || null;
    box.replaceChildren(...[
      h("h4", {}, "Cursor through the official SDK"),
      h("p", { class: "small" }, "Cursor's agent runs inside Filament's own process through ", h("code", {}, "@cursor/sdk"), ", with a Cursor API key from ", h("a", { href: "https://cursor.com/dashboard?tab=integrations", target: "_blank", rel: "noopener" }, "cursor.com/dashboard → Integrations"), ". Runs bill your Cursor plan like the IDE and show under the SDK tag in Cursor's usage. The Cursor CLI route (", h("code", {}, "cursor/…"), ") keeps working next to it; try both and keep the one that feels more native."),
      h("div", { class: "kv" },
        h("span", {}, "SDK"), h("span", {}, installed ? h("span", { class: "pill ok" }, `installed ${st.version || ""}`) : h("span", { class: "pill warn" }, "not installed"), installed && st.path ? h("span", { class: "muted small mono" }, ` ${st.path}`) : null, !st?.nodeOk ? h("span", { class: "err small" }, ` Node ${st?.node} is too old (needs 22.13+)`) : null),
        h("span", {}, "API key"), h("span", {}, u.apiKey ? h("span", { class: "pill ok" }, "set") : h("span", { class: "pill warn" }, "paste it above, then Save")),
      ),
      installed ? null : h("div", { class: "row" }, h("button", { class: "primary", disabled: busy ? "" : null, onclick: install }, busy ? "Installing… (about 50 MB, a minute or two)" : "Install the Cursor SDK now"),
        busy ? h("button", { class: "sm", disabled: stopping ? "" : null, title: "End the install now: npm and what it started are stopped. Nothing here ends it by itself, however long the download takes.", onclick: stop }, stopping ? "Stopping…" : "Stop") : null,
        h("span", { class: "muted small" }, busy && live ? `running for ${fmt.ms(Math.max(0, Date.now() - live.since))}` : ["runs ", h("code", {}, st?.install || "npm install -g @cursor/sdk"), " for you"])),
      !installed && busy ? h("pre", { class: "small" }, live?.output || "npm has printed nothing yet") : null,
      !busy && result?.stopped ? h("p", { class: "small muted" }, "You stopped the install. Install runs it again from the start.") : null,
      !busy && result && !result.ok ? h("pre", { class: "small" }, result.output || "") : null,
      h("p", { class: "small muted" }, "Model names: ", h("code", {}, `${prefix}grok-4.6-xhigh`), ", ", h("code", {}, `${prefix}grok-4.6-fast`), ", ", h("code", {}, `${prefix}composer-2.5`), ", ", h("code", {}, `${prefix}auto`), "; add ", h("code", {}, "@plan"), " for plan mode. Press Test to check the key and list Cursor's models. With client bridge ", h("code", {}, "full"), ", Cursor's read/edit/shell/delete are replaced by Filament's tools running through your chat tool, so edits and commands appear as its own cards under its own permission mode; the default ", h("code", {}, "prompts"), " keeps Cursor's own tools and shows them as diff and output blocks."),
    ].filter(Boolean));
  };
  draw(); api("/sdk/status").then((now) => { st = now; draw(); watch(); }).catch(() => { st = { installed: false }; draw(); });
  return box;
};
    const agentGuide = (u) => {
      const key = `guide.${u.id}`; const box = h("div", { class: "guide-body" }, h("span", { class: "muted small" }, "asking the agent what it offers…"));
      const det = h("details", { class: "subform guide", open: store.get(key) === "open" || new URLSearchParams(location.search).get("guide") === u.id ? "" : null, ontoggle: (e) => store.set(key, e.target.open ? "open" : "closed") }, h("summary", {}, `How to use ${(u.name || u.id).replace(" (agent via ACP)", "")} from your chat client: models, effort, context window, modes, sessions, commands`), box);
      const draw = (refresh) => api(`/acp/${encodeURIComponent(u.id)}/offer${refresh ? "?refresh=1" : ""}`).then((o) => {
        if (!o.ok) return box.replaceChildren(h("p", { class: "err small" }, `The agent could not be started: ${o.error}`), ...(o.login ? [h("p", { class: "small muted" }, `If it is a login problem, run: ${o.login} (or press Log in in the agents table above).`)] : []));
        const pre = o.prefix || `${u.id}/`; const g = o.guide || {}; const models = (o.models || []).filter((m) => m !== "default");
        const ex = models[0] || "auto"; const name = (m) => `${pre}${m}`;
        const row = (want, ...how) => h("tr", {}, h("td", { class: "cmp-head" }, want), h("td", {}, ...how));
        const bigCtx = models.filter((m) => /\[1m\]|-1m\b|1m$/i.test(m));
        // What the agent declares comes first, then, dashed, what it does not.
        const supports = o.profile ? supportsRows(o.profile).sort((a, b) => Number(b.has) - Number(a.has)) : [];
        const modeWords = { agent: "@agent", plan: "@plan", ask: "@ask" };
        const rows = [
          row("Use it at all", h("span", {}, "Pick or type a model name that starts with ", h("code", {}, pre), " in your chat client. Example: "), copyline(name(ex)), h("div", { class: "muted small" }, "Anthropic-format and OpenAI-format clients both work; the Anthropic format shows thinking best.")),
          supports.length ? row("What it supports", h("div", {}, h("div", { class: "chips-wrap" }, ...supports.map((s) => h("span", { class: s.has ? "pill ok" : "pill lacks", title: s.means }, s.word))), h("details", { class: "small", style: "margin-top:6px" }, h("summary", { class: "muted" }, "What each means here"), h("ul", { class: "small", style: "margin:6px 0 0" }, ...supports.map((s) => h("li", {}, h("b", {}, s.word), s.has ? null : h("span", { class: "muted" }, " (not declared)"), ` — ${s.means}`)))), h("div", { class: "muted small", style: "margin-top:4px" }, "As the agent itself declared it when Filament started it."))) : null,
          row("Choose the model", models.length ? h("div", {}, h("div", { class: "chips-wrap" }, ...models.slice(0, 14).map((m) => copyline(name(m)))), models.length > 14 ? h("div", { class: "muted small" }, `…and ${models.length - 14} more in the list below`) : null, o.modelConfig ? h("div", { class: "muted small" }, "Switching the name mid-chat switches the model inside the same agent session.") : null) : h("span", { class: "muted" }, "This agent uses its own default model; it did not list alternatives.")),
          row("Reasoning effort", o.efforts?.length ? h("div", {}, h("span", {}, `Levels this agent accepts: ${o.efforts.filter((x) => x !== "default").join(", ")}. Add a suffix, e.g. `), copyline(`${name(ex)}-xhigh`), h("span", {}, ", or use your client's effort picker; Filament applies it to the session each turn.")) : h("span", {}, g.effort || "Not adjustable from the client; pick the model instead.")),
          (() => { const extra = (o.configOptions || []).filter((x) => !/^(mode|model|effort)$/i.test(x.id) && (x.values || []).length > 1); if (!extra.length) return null; const isBool = (x) => x.values.every((v) => /^(true|false)$/i.test(v.value)); return row("Other model options", h("div", {}, h("span", {}, "Put the word in the model name; leave it out to turn it off: "), ...extra.map((x) => h("code", { style: "margin-right:6px", title: `${x.name}: ${x.values.map((v) => v.value).join(", ")}` }, isBool(x) ? `-${x.id}` : `-<${x.values.map((v) => v.value).join("|")}>`)), h("div", { class: "muted small" }, `Example: `, h("code", {}, `${name(ex)}${extra.some((x) => /^fast$/i.test(x.id)) ? "-fast" : ""}`), `. Filament sets these on the agent's session for you (the agent also makes that its own current selection).`))); })(),
          row("Context window", h("div", {}, h("span", {}, g.context || "Fixed per model."), bigCtx.length ? h("div", { class: "chips-wrap", style: "margin-top:4px" }, ...bigCtx.map((m) => copyline(name(m)))) : null)),
          row("Agent mode (permissions / plan)", h("div", {}, h("span", {}, "Add ", h("code", {}, "@agent"), ", ", h("code", {}, "@plan"), " or ", h("code", {}, "@ask"), " to the model name, e.g. "), copyline(`${name(ex)}@plan`), h("span", {}, ". Works mid-conversation."), o.modes?.length ? h("ul", { class: "small", style: "margin:6px 0 0" }, ...o.modes.map((m) => h("li", {}, h("code", {}, `@${m.id}`), m.name && m.name !== m.id ? ` ${m.name}` : "", m.description ? h("span", { class: "muted" }, ` — ${m.description}`) : "", o.currentMode === m.id ? h("span", { class: "pill", style: "margin-left:6px" }, "agent default") : null))) : null, h("div", { class: "muted small", style: "margin-top:4px" }, `Filament's default for this upstream: ${u.acp?.mode || "agent"} (Agent settings above). Permission prompts are answered by the ${u.acp?.permissions || "allow-all"} policy.`))),
          row("Continue an earlier chat", o.profile?.sessions.list ? h("div", {}, h("span", {}, "Start a chat in your client with a name like "), copyline(`${name(ex)}#3716601d`), h("span", {}, ": the session whose id starts with those characters goes on in it. Home → Agents lists them"), o.sessionsKnown != null ? h("span", {}, ` (${o.sessionsKnown} known right now)`) : null, h("span", {}, "."), h("div", { class: "muted small" }, (g.resume || "").replace(/<prefix>/g, pre))) : h("span", {}, (g.resume || "One agent session per client chat; the agent does not list past sessions to clients.").replace(/<prefix>/g, pre))),
          row("Start over", h("span", {}, "Start a new chat in your client: its first message opens a fresh agent session. The client's own /compact and /clear only shorten the client's copy of the chat; the agent keeps its own memory. A command typed in the chat goes to the agent as typed, except memory's @mem and /goal, which Filament answers.")),
          row("When something cannot be applied", h("span", {}, "A model or mode the agent lacks, an ignored effort, a dropped image: Filament adds one short italic line to the reply, once per conversation, so you are not left guessing. The request record on the Requests page has the full story. Switch the notes off with the ", h("code", {}, "hints"), " setting under Agent settings.")),
          row("Agent commands", o.commands?.length ? h("details", {}, h("summary", { class: "small" }, `${o.commands.length} commands published by the agent: type them as /name in the chat`), h("ul", { class: "small", style: "margin:6px 0 0;max-height:220px;overflow:auto" }, ...o.commands.map((c) => h("li", {}, h("code", {}, `/${c.name}`), c.description ? h("span", { class: "muted" }, ` — ${c.description.slice(0, 120)}`) : "")))) : h("span", { class: "muted" }, "None published to clients. Anything else starting with / is passed to the agent as text.")),
          row("Images and files", h("span", {}, o.profile?.prompt.image ? "Pasted images go through. " : "This agent does not accept images (they are dropped with a note). ", o.profile?.prompt.embeddedContext ? "Attached files go through as files." : "Attached text files are pasted into the prompt; binary files are announced to the agent, which can read them by path.")),
          row("Tokens and cost", h("div", {}, h("span", {}, g.tokens || "Reported by the agent when it does; otherwise estimated at ~4 characters per token."), h("div", { class: "muted small", style: "margin-top:4px" }, "Each turn's tokens and cost, and the model, mode and effort the agent ran with, are on its row under Traffic; Usage sums them by model and day."))),
          row("Login and billing", h("span", {}, o.account || "the agent's own login", o.login ? h("span", { class: "muted" }, ` · log in with: `) : null, o.login ? h("code", {}, o.login) : null)),
        ];
        const other = (o.configOptions || []).filter((c) => !/model|effort|^mode$/i.test(c.id));
        if (other.length) rows.push(row("Other session settings", h("ul", { class: "small", style: "margin:0" }, ...other.map((c) => h("li", {}, h("b", {}, c.name), `: ${c.values.map((v) => v.value).join(", ")}`, c.current != null ? h("span", { class: "muted" }, ` (agent default: ${c.current})`) : null)), h("li", { class: "muted" }, "Filament leaves these at the agent's defaults."))));
        box.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small cmp guide-table" }, h("tbody", {}, ...rows))), h("div", { class: "row", style: "margin:8px 0 0;align-items:center" }, h("span", { class: "muted small" }, `Asked ${o.profile?.agent?.title || o.profile?.agent?.name || u.id}${o.profile?.agent?.version ? ` ${o.profile.agent.version}` : ""} ${o.at ? new Date(o.at).toLocaleTimeString() : ""}.`), h("span", { class: "grow" }), h("button", { class: "sm ghost", onclick: () => { box.replaceChildren(h("span", { class: "muted small" }, "asking the agent…")); draw(true); } }, "Ask again")));
      }).catch((e) => box.replaceChildren(h("span", { class: "err small" }, e.message)));
      if (det.open) draw(false); else det.addEventListener("toggle", () => { if (det.open && !det.dataset.loaded) { det.dataset.loaded = "1"; draw(false); } }, { once: false });
      return det;
    };
    // 30-day usage per upstream × model, for the model table (cached for a minute)
    const usage30 = () => { const now = Date.now(); if (state._usage30 && now - state._usage30.at < 60000) return state._usage30.p; const d = new Date(); d.setDate(d.getDate() - 29); const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; const p = api(`/usage/days?from=${from}`).then((r) => { const m = new Map(); for (const row of r.total?.rows || []) m.set(`${row.upstream}|${row.model}`, row); return m; }).catch(() => new Map()); state._usage30 = { at: now, p }; return p; };
    const modelsPanel = (u) => {
      const box = h("div", { class: "models-box" }, h("span", { class: "muted small" }, "loading model list…"));
      let filter = "", showAll = false; const results = {}; const opened = new Set();
      // One row per model, its variants folded in (Providers P2) — the grouping the harness's picker shows. POST
      // /models/caps with `families` answers this upstream's families over every name it offers, the hidden ones too
      // (ticked here from this draft's hiddenModels), with a model card — what it can do, its list price — for each
      // family's lead, from this draft's rows and rules. A family's Tune opens on its lead; its ▸ lists its ids.
      const loadCaps = capsLoader(api, { families: true }); let drawSeq = 0;
      const ping = async (name) => { results[name] = null; draw(); try { results[name] = await api("/models/ping", { method: "POST", body: { model: name } }); } catch (/** @type {any} */ e) { results[name] = { ok: false, error: e.message }; } draw(); };
      // A typed name's Add or × (HarnessV4_Tasks E9): saved at once when nothing else waits to be saved, as "Add route
      // and save" is; otherwise it joins the unsaved changes, and says so. A save that fails puts the lists back.
      /** @param {() => void} change @param {string} words */
      const keepTyped = async (change, words) => {
        if (state.dirty) { change(); markDirty(); toast(`${words} In your unsaved changes: press Save changes (top right).`); draw(); return; }
        const before = { models: u.models ? [...u.models] : null, hidden: u.hiddenModels ? [...u.hiddenModels] : null };
        change();
        try { const r = await putConfig(state.config); state.config = r.config; state.saved = structuredClone(r.config); markDirty(false); modelsP = null; toast(`${words} Saved.`); render(); }
        catch (/** @type {any} */ e) { if (before.models) u.models = before.models; else delete u.models; if (before.hidden) u.hiddenModels = before.hidden; else delete u.hiddenModels; toast(e.message, "err"); draw(); }
      };
      const PRICE_FROM = { upstream: "set on this upstream", builtin: "Filament's built-in API rates" };
      const draw = () => { const seq = ++drawSeq; return Promise.all([models(), usage30(), loadCaps(u)]).then(([m, use, cr]) => {
        if (seq !== drawSeq) return;
        const hiddenSet = new Set((u.hiddenModels || []).map((x) => String(x).toLowerCase()));
        const info = m.upstreams?.[u.id] || {};
        // advertised names (the server already drops saved hidden ones) minus names hidden in the unsaved draft
        const mine = m.models.filter((x) => x.upstream === u.id && x.source !== "effort-variant" && !hiddenSet.has(String(x.upstreamModel || "").toLowerCase()));
        // hiddenModels speaks for discovered names: a name an exact route spells is always offered
        const hidable = (x) => x.source !== "route";
        const isHidden = (x) => hidable(x) && hiddenSet.has(String(x.name).toLowerCase());
        const setHidden = (names, hide) => { const low = new Set(names.map((n) => String(n).toLowerCase())); const list = (u.hiddenModels || []).filter((x) => !low.has(String(x).toLowerCase())); if (hide) list.push(...names); u.hiddenModels = list; markDirty(); draw(); };
        const fams = cr.families || [];
        const chat = fams.filter((f) => f.kind !== "other"), other = fams.filter((f) => f.kind === "other");
        const allIds = fams.flatMap((f) => f.members);
        const hiddenCount = allIds.filter(isHidden).length;
        const match = (f) => !filter || [f.id, f.name, ...f.members.map((x) => x.id)].some((s) => String(s).toLowerCase().includes(filter));
        const shown = chat.filter(match); const LIMIT = 40; const list2 = showAll || filter ? shown : shown.slice(0, LIMIT);
        const search = h("input", { type: "text", placeholder: "filter", value: filter, style: "max-width:200px" }); search.oninput = () => { filter = search.value.trim().toLowerCase(); draw(); setTimeout(() => { const el = box.querySelector("input[placeholder=filter]"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); };
        const agentUp = isAgentUp(u);
        const custom = h("input", { type: "text", class: "mono", placeholder: "or type any model name…", "aria-label": "A model name to ping or add", style: "max-width:260px" }); const customBtn = h("button", { class: "sm", onclick: () => { const n = custom.value.trim(); if (!n) return; box.querySelector(".ping-custom-out")?.replaceChildren(h("code", {}, n), " ", h("span", { class: "muted small" }, "pinging…")); api("/models/ping", { method: "POST", body: { model: n } }).then((r) => box.querySelector(".ping-custom-out")?.replaceChildren(h("code", {}, n), " ", pingResult(r))).catch((e) => box.querySelector(".ping-custom-out")?.replaceChildren(h("code", {}, n), " ", h("span", { class: "pill err" }, e.message))); } }, "Ping");
        // A name you type is kept (HarnessV4_Tasks E9): it joins this upstream's typed names — the same list as "extra
        // models to advertise" — and every picker offers it beside the names the provider lists.
        const typedLow = new Set((u.models || []).map((x) => String(x).toLowerCase()));
        const listedLow = Array.isArray(info.listed) ? new Set(info.listed.map((x) => String(x).toLowerCase())) : null;
        const who = u.name || u.id;
        const notListed = agentUp ? `${who} does not list it: a turn on it says what the agent did with it.` : `It is not in ${who}'s own list: Ping tells whether it answers.`;
        const addBtn = h("button", { class: "sm", title: `Keep this name in ${who}'s list: every picker offers it, beside the names ${who} lists itself`, onclick: () => {
          const n = custom.value.trim(); const low = n.toLowerCase(); const out = box.querySelector(".ping-custom-out");
          if (!n) return;
          if (n.includes(",")) { out?.replaceChildren(h("span", { class: "pill err" }, "A model name has no comma: the typed names are kept as a comma list")); return; }
          const hidden = (u.hiddenModels || []).some((x) => String(x).toLowerCase() === low);
          const listedHere = !!listedLow?.has(low);
          if ((typedLow.has(low) || listedHere) && !hidden) { out?.replaceChildren(h("code", {}, n), " ", h("span", { class: "muted small" }, typedLow.has(low) ? "is one of the names you typed already" : `is in ${who}'s own list already`)); return; }
          keepTyped(() => {
            if (hidden) u.hiddenModels = (u.hiddenModels || []).filter((x) => String(x).toLowerCase() !== low);
            if (!typedLow.has(low) && !listedHere) u.models = [...(u.models || []), n];
          }, `${n} ${hidden && (typedLow.has(low) || listedHere) ? "is shown again" : "is kept"}${!hidden && listedLow && !listedHere ? `. ${notListed}` : "."}`);
        } }, "Add");
        /** A name you typed, on its row: said, with a × that takes it off your typed names. @param {string} name */
        const typedMark = (name) => {
          const low = String(name).toLowerCase();
          if (!typedLow.has(low)) return null;
          const out = !!listedLow && !listedLow.has(low);
          return h("span", { class: "muted small typed-mark", title: out ? `You typed this name. ${notListed}` : `You typed this name; ${who} lists it too, so it stays when you remove it here` }, out ? " · typed, not in its list" : " · typed",
            h("button", { type: "button", class: "typed-x", "aria-label": `Remove ${name} from the names you typed`, title: `Remove ${name} from the names you typed`, onclick: () => keepTyped(() => { u.models = (u.models || []).filter((x) => String(x).toLowerCase() !== low); }, `${name} is no longer one of your typed names.`) }, "×"));
        };
        const readErr = cr.error ? (/not in the saved configuration/.test(cr.error) ? "Save changes first: the model list is read from the saved configuration." : `The model list could not be read: ${cr.error}`) : null;
        const why = u.enabled === false ? "This upstream is disabled, so nothing is advertised. Tick “enabled” above and save." : info.discovering ? `Asking ${u.name || u.id} for its models…` : info.error ? `Could not fetch its model list: ${String(info.error).replace(/\.\s*$/, "")}. ${agentUp ? "Once that is fixed, press Refresh list." : "Check the key or login above, then Refresh."}` : !(c.routes || []).some((r) => r.upstream === u.id && r.enabled !== false) ? "Nothing reaches it yet: no route points at it. Give it a prefix above and your tools ask for its models as prefix/model." : fams.length ? null : readErr || (info.unasked ? `Not asked yet: Filament asks ${u.name || u.id} for its models when you press Refresh list — never just to draw this page. Or add names under “extra models to advertise”.` : "Enabled, but no model names came back. Add names under “extra models to advertise”, or check the connection.");
        // 30-day use of a family: its ids added up (the column only when this upstream has had traffic)
        const famUse = (f) => { let requests = 0, cost = 0, costN = 0, listCost = 0, listCostN = 0; for (const x of f.members) { const r = use.get(`${u.id}|${x.name}`); if (r) { requests += r.requests || 0; cost += r.cost || 0; costN += r.costN || 0; listCost += r.listCost || 0; listCostN += r.listCostN || 0; } } return requests ? { requests, cost, costN, listCost, listCostN } : null; };
        // paid, and the same tokens at list price when the two part (Providers P4: a plan pays $0)
        const useWords = (r) => (r ? `${fmt.n(r.requests)} · ${r.costN ? fmt.usd(r.cost) : "–"}${r.listCostN && listDiffers(r.cost, r.listCost) ? ` · ${fmt.usd(r.listCost)} at list` : ""}` : "–");
        const anyUse = fams.some((f) => famUse(f));
        // The list price, quiet: what the cost figures read (Tune → Pricing sets it); no warning for none.
        const priceCell = (entry) => {
          const p = entry?.price; const has = !!p && (Number(p.input) > 0 || Number(p.output) > 0);
          // An agent bills its plan; a row the operator wrote gives its turns a list figure (decision 26), a built-in rate never does.
          if (agentUp) {
            const listed = has && p.source === "upstream";
            return h("td", { class: "num muted small list-price", title: listed ? `Agent turns bill the agent's plan; their “at list” figure reads this price per million tokens, in / out — ${PRICE_FROM[p.source] || p.source}. Tune → Pricing changes it.` : "Agent turns bill the agent's plan. Tune → Pricing can give them a list price for the “at list” figures." }, listed ? `plan · ${fmtPrice(p.input)} / ${fmtPrice(p.output)}` : "plan");
          }
          return h("td", { class: "num muted small list-price", title: has ? `List price per million tokens, in / out — ${PRICE_FROM[p.source] || p.source}. Tune → Pricing changes it; only the cost figures read it.` : "No list price known. Tune → Pricing adds one; only the cost figures read it." }, has ? `${fmtPrice(p.input)} / ${fmtPrice(p.output)}` : "–");
        };
        const tune = (f, entry) => { const lead = f.members.find((x) => x.id === f.lead) || f.members[0]; if (!entry?.caps) return toast(cr.error ? `Could not read what ${lead.id} can do: ${cr.error}` : `${lead.id} does not resolve to this upstream in the saved configuration: save first, then tune it.`, "err"); openTune({ u, x: { id: lead.id, upstreamModel: lead.name }, entry, load: loadCaps, agent: agentUp, models: allIds.map((x) => ({ id: x.id, upstreamModel: x.name })), onApply: ({ key, row }) => { u.pricing ||= {}; if (row) u.pricing[key] = row; else delete u.pricing[key]; markDirty(); draw(); toast(`${key}: in your unsaved changes — press Save changes to put it in force.`); } }, tuneKit()); };
        const pingBtn = (id, title) => { const r = results[id]; return [h("button", { class: `model-btn ${r === null ? "pinging" : r ? (r.ok ? "ok" : "bad") : ""}`, title, onclick: () => ping(id) }, h("code", {}, id)), r === null ? h("span", { class: "muted small" }, " pinging…") : r ? h("span", { class: "ping-out" }, " ", pingResult(r)) : null]; };
        const tick = (label, title, on, disabled, names) => { const t = h("input", { type: "checkbox", class: "fam-tick", "aria-label": label, title, onchange: (e) => setHidden(names, !e.target.checked) }); t.checked = on; t.disabled = disabled; return t; };
        const memberRow = (x) => h("tr", { class: `member-line${isHidden(x) ? " off" : ""}`, "data-member": x.id },
          h("td", { class: "tick-cell" }, tick(`Offer ${x.id} in pickers`, hidable(x) ? (isHidden(x) ? "Hidden from pickers: tick to offer it" : "Offered in pickers: untick to hide just this id") : "A route names it, so it is always offered", !isHidden(x), !hidable(x), [x.name])),
          h("td", { class: "model-cell member" }, ...pingBtn(x.id, `${x.id} → ${u.id} receives “${x.name}”. Click to ping it: a tiny real request through your routes and rules.`), h("span", { class: "muted small spells" }, ` ${spelledWords(x)}`), typedMark(x.name), isHidden(x) ? h("span", { class: "muted small" }, " · hidden") : null),
          anyUse ? h("td", { class: "num muted small" }, useWords(use.get(`${u.id}|${x.name}`) || null)) : null,
          h("td", {}), h("td", {}));
        const famRows = (f) => {
          const entry = cr.byId.get(f.lead); const lead = f.members.find((x) => x.id === f.lead) || f.members[0];
          const many = f.members.length > 1; const open = opened.has(f.id);
          const can = f.members.filter(hidable); const off = can.filter(isHidden); const allOff = !!can.length && off.length === can.length;
          const t = tick(`Offer ${f.id} in pickers`, can.length ? (allOff ? "Hidden from pickers: tick to offer it (its names still work when asked for)" : off.length ? `${off.length} of its ${can.length} ids are hidden: untick to hide them all, tick to offer them all` : "Offered in pickers: untick to hide it (its names still work when asked for)") : "A route names it, so it is always offered", !allOff, !can.length, can.map((x) => x.name));
          if (off.length && !allOff) /** @type {any} */ (t).indeterminate = true;
          const chips = entry ? capChips(h, entry, { window: false }) : [];
          if (!chips.length) chips.push(h("span", { class: "muted small", title: cr.error ? `could not be read: ${cr.error}` : "nothing known beyond plain requests: tune it to say what it can do" }, cr.error ? "can do: not read" : "plain requests"));
          const w = entry?.offer?.window, cw = entry?.caps?.window; const std = Number(w?.standard) || Number(cw?.standard) || 0;
          const winText = familyWindowWords(w, cw);
          const winTitle = std ? `standard context window: ${fmt.n(std)} tokens — ${sourceLong(cw?.standardSource)}${winText.includes("·") ? `; a session may choose ${winText}` : ""}` : winText.includes("?") ? "Nobody states the standard window of its plain id (the ? ) — tune it to set one; the other windows are ids of their own" : "No context window known: tune it to set one — every request record then says how much of it the request wants, and /autofit can fit a session to it";
          const tuneBtn = h("button", { class: "sm ghost tune-btn", title: `Tune ${f.id}: its reasoning levels, fast mode and what it costs, thinking, context windows, output ceiling and list price at this upstream`, onclick: () => tune(f, entry) }, "tune");
          const name = many
            ? [h("button", { type: "button", class: "fam-toggle", "aria-expanded": open ? "true" : "false", title: open ? "Fold its ids" : `Show its ${f.members.length} ids`, onclick: () => { if (open) opened.delete(f.id); else opened.add(f.id); draw(); } }, h("span", { class: "fam-caret" }, open ? "▾" : "▸"), " ", h("code", {}, f.id), h("span", { class: "muted small" }, ` · ${f.members.length} ids`))]
            : pingBtn(lead.id, `${lead.id} → ${u.id} receives “${lead.name}” (${lead.source || "discovered"}). Click to ping: a tiny real request through your routes and rules.`);
          return [h("tr", { class: `fam-line${allOff ? " off" : ""}`, "data-family": f.id },
            h("td", { class: "tick-cell" }, t),
            h("td", { class: "model-cell" }, ...name, many ? null : typedMark(lead.name), tuneBtn, allOff ? h("span", { class: "muted small" }, " · hidden") : off.length ? h("span", { class: "muted small" }, ` · ${off.length} hidden`) : null, h("div", { class: "caps-line" }, h("span", { class: "cap-chips" }, ...chips))),
            anyUse ? h("td", { class: "num muted small", title: "requests and spend through this upstream in the last 30 days, its ids added up" }, useWords(famUse(f))) : null,
            h("td", { class: "num fam-window", title: winTitle }, winText),
            priceCell(entry)),
            ...(many && open ? f.members.map(memberRow) : [])];
        };
        const capNote = h("div", { class: "cap-note" }, ...(cr.errors?.length ? [h("span", { class: "err small" }, `This upstream's model rows have problems a save would refuse: ${cr.errors.join("; ")}`)] : []));
        const head = h("tr", {}, h("th", { class: "tick-cell", title: "Offered in pickers; unticked ones still work when asked for by name" }, "show"), h("th", { title: "One row per model, its variants folded in, as the harness's picker shows it. Under it: what the picker offers for it, each part styled by who said it (the legend above)" }, "model · what it can do"), anyUse ? h("th", { class: "num" }, "30 days") : null, h("th", { class: "num", title: "The standard context window, then the others a session may choose: what the context meter and /autofit measure against" }, "window"), h("th", { class: "num", title: "List price per million tokens at this provider. Tune → Pricing sets it; only the cost figures read it" }, "list $/M in / out"));
        // Discovered at the provider but not reachable yet: no route points here. Show what was fetched and offer the route.
        const routed = (c.routes || []).some((r) => r.upstream === u.id && r.enabled !== false);
        const addPrefixRoute = async (btn) => {
          const match = `${u.id}/*`; if ((c.routes || []).some((r) => r.match === match)) { toast(`Route ${match} already exists`); return; }
          const route = { match, upstream: u.id, upstreamModel: "{1}", format: "auto", fallbacks: [], discoverPrefixes: [], enabled: true, rules: {} };
          if (!state.dirty) { // nothing else pending: save the route now so the list fills in right away
            if (btn) { btn.disabled = true; btn.textContent = "saving…"; }
            (c.routes ||= []).unshift(route);
            try { const r = await putConfig(state.config); state.config = r.config; state.saved = structuredClone(r.config); markDirty(false); modelsP = null; toast(`Route ${match} saved. Clients can now ask for ${u.id}/<model>.`); render(); return; }
            catch (/** @type {any} */ e) { c.routes.shift(); toast(e.message, "err"); if (btn) { btn.disabled = false; btn.textContent = `Add route ${match} and save`; } return; }
          }
          (c.routes ||= []).unshift(route); markDirty(); toast(`Route ${match} added to your unsaved changes. Press Save changes (top right); the list fills in after that.`); render();
        };
        const savedRouted = (state.saved?.routes || []).some((r) => r.upstream === u.id && r.enabled !== false);
        const pending = routed && !savedRouted && !mine.length && (info.all || []).length ? h("div", { class: "fo-box warn-box", style: "margin:0 0 10px" },
          h("div", {}, h("b", {}, `Unsaved route: press Save changes (top right) and these ${info.all.length} models go live as `), h("code", {}, `${u.id}/<model>`), h("span", { class: "muted small" }, " Refresh list only reads the saved configuration.")),
          h("div", { class: "chips-wrap", style: "margin-top:8px" }, ...info.all.slice(0, 60).map((n) => h("code", { class: "chip", title: `${u.id}/${n}` }, n)))) : null;
        const discovered = pending || (!routed && !agentUp && (info.all || []).length ? h("div", { class: "fo-box", style: "margin:0 0 10px" },
          h("div", { class: "row", style: "align-items:center;gap:10px;flex-wrap:wrap" }, h("b", {}, `${info.all.length} model${info.all.length === 1 ? "" : "s"} fetched from this provider`), h("span", { class: "muted small" }, "They are not reachable yet: no route points at this upstream. Add one and clients can ask for them as "), h("code", {}, `${u.id}/<model>`), h("button", { class: "primary sm", onclick: (e) => addPrefixRoute(e.target) }, state.dirty ? `Add route ${u.id}/*` : `Add route ${u.id}/* and save`)),
          h("div", { class: "chips-wrap", style: "margin-top:8px" }, ...info.all.slice(0, 60).map((n) => h("code", { class: "chip", title: `${u.id}/${n}` }, n)), info.all.length > 60 ? h("span", { class: "muted small" }, ` +${info.all.length - 60} more`) : null)) : null);
        const otherBox = other.length ? h("details", { class: "other-models" }, h("summary", { class: "small" }, `Other models (not for chat) · ${other.length}`, h("span", { class: "muted" }, " — embedding, rerank, speech and image models: never in chat pickers; the ticked ones are listed for your tools")),
          h("div", { class: "table-wrap" }, h("table", { class: "small models-table" }, h("tbody", {}, ...other.filter(match).map((f) => { const x = f.members[0]; return h("tr", { class: `other-line${isHidden(x) ? " off" : ""}`, "data-other": x.id }, h("td", { class: "tick-cell" }, tick(`List ${x.id} for your tools`, hidable(x) ? (isHidden(x) ? "Not listed: tick to list it for your tools" : "Listed for your tools (never in chat pickers): untick to leave it out") : "A route names it, so it is always listed", !isHidden(x), !hidable(x), [x.name])), h("td", { class: "model-cell" }, ...pingBtn(x.id, `${x.id}: click to ping it — a chat request, which a model that is not for chat may refuse`))); }))))) : null;
        box.replaceChildren(...[
          h("div", { class: "toolbar wrap", style: "margin-bottom:8px" }, h("b", { class: "small" }, `Models · ${chat.length}${hiddenCount ? ` (${hiddenCount} id${hiddenCount === 1 ? "" : "s"} hidden)` : ""}`), h("span", { class: "muted small" }, chat.length ? `${allIds.length - other.length} id${allIds.length - other.length === 1 ? "" : "s"} as ${chat.length} model${chat.length === 1 ? "" : "s"}${other.length ? `, and ${other.length} not for chat` : ""}` : ""), h("span", { class: "grow" }), chat.length > 8 ? search : null, h("button", { class: "sm", title: "Ask this upstream (and the others) for a fresh model list. Reads the saved configuration: a route that is still unsaved does not count yet", onclick: () => { modelsP = null; loadCaps.clear(); box.replaceChildren(h("span", { class: "muted small" }, "asking the upstream…")); models(true).then(draw); } }, "Refresh list")),
          discovered,
          why && !discovered ? h("p", { class: "muted small", style: "margin:0 0 8px" }, why) : why ? null : h("p", { class: "muted small", style: "margin:0 0 8px" }, agentUp ? "One row per model, its variants folded in, as the harness's picker shows it; ▸ lists a model's ids. Click an id to ping it. Untick a model to keep it out of pickers (its names still work when asked for). Tune sets its reasoning or context window. Agent turns are paid by the agent's subscription; Tune → Pricing can give a model a list price, for what the same tokens would cost per token. Press Save changes when done." : "One row per model, its variants folded in, as the harness's picker shows it; ▸ lists a model's ids. Click an id to ping it (a tiny real request through your routes and rules). Untick a model to keep it out of pickers — its names still work when asked for. Tune sets what it can do here and, under Pricing, its list price. Press Save changes when done."),
          allIds.length > 1 ? h("div", { class: "row", style: "margin:0 0 8px;gap:8px" }, h("button", { class: "sm ghost", title: "Hide every model of this upstream from the pickers, then tick the few you want", onclick: () => { u.hiddenModels = [...new Set([...(info.all || []), ...allIds.filter(hidable).map((x) => x.name)].filter(Boolean))]; markDirty(); draw(); } }, "Hide all"), hiddenCount ? h("button", { class: "sm ghost", onclick: () => { u.hiddenModels = []; markDirty(); draw(); } }, `Show all (${hiddenCount} hidden)`) : null) : null,
          list2.length ? capLegend(h) : null,
          capNote,
          list2.length ? h("div", { class: "table-wrap" }, h("table", { class: "small models-table fam-table" }, h("thead", {}, head), h("tbody", {}, ...list2.flatMap(famRows)))) : null,
          shown.length > LIMIT && !filter ? h("button", { class: "sm ghost", style: "margin-top:6px", onclick: () => { showAll = !showAll; draw(); } }, showAll ? "show fewer" : `show all ${shown.length}`) : null,
          otherBox,
          h("div", { class: "row", style: "margin:10px 0 0" }, custom, customBtn, addBtn, h("span", { class: "ping-custom-out small" }))].filter(Boolean)); // replaceChildren(null) would print the word "null"
      }).catch((e) => box.replaceChildren(h("span", { class: "err small" }, e.message))); };
      draw(); return box;
    };
    const only = new URLSearchParams(location.search).get("only"); // ?only=<id> shows one upstream card (deep links, screenshots)
    if (new URLSearchParams(location.search).get("add") && state.addUp == null) state.addUp = true; // ?add=1 opens the add flow
    if (only) state.selUp = only;
    else if (!state.selUp || !c.upstreams.some((u) => u.id === state.selUp)) state.selUp = c.upstreams[0]?.id || null;
    const rail = h("nav", { class: "conn-rail", "aria-label": "Upstreams" },
      ...c.upstreams.map((u) => {
        const kind = u.type === "acp" ? "ACP" : u.type === "qoder" ? "Qoder" : providerFor(state._providers?.providers, u.baseUrl)?.provider.name || (types[u.type]?.label || u.type || "").replace(/ \(.*\)$/, "");
        const n = (c.routes || []).filter((r) => r.upstream === u.id).length;
        const pr = prefixRouteOf(c, u.id);
        return h("button", { type: "button", class: `conn-item${u.id === state.selUp && !state.addUp ? " on" : ""}${u.enabled === false ? " off" : ""}`, onclick: () => { state.selUp = u.id; state.addUp = false; state.justAdded = null; render(); } },
          h("b", {}, u.name || u.id || "Untitled"),
          h("span", { class: "meta" }, `${kind} · ${pr ? pr.match.slice(0, -1) : `${n} route${n === 1 ? "" : "s"}`}`));
      }),
      h("button", { type: "button", class: `conn-item add${state.addUp ? " on" : ""}`, onclick: () => { state.addUp = true; render(); } }, h("b", {}, "+ Add"), h("span", { class: "meta" }, "New provider")));
    // Adding a destination (Providers P1): API providers through "Add a provider" (the catalogue, a key, the probe's
    // families, one save); agents come from the detected list below; Cursor SDK and Qoder cloud come from their
    // templates (upstream + route in one go) — Cursor SDK only where Settings › Experimental's switch for it is on.
    const viaTemplate = async (templateId, upstreamId) => { if (c.upstreams.some((u) => u.id === upstreamId)) { state.selUp = upstreamId; state.addUp = false; return render(); } if (state.dirty && !confirm("Applying a template saves the configuration on the server, which discards your unsaved edits. Continue?")) return; try { await api(`/templates/${templateId}/apply`, { method: "POST" }); await loadAll({ force: true }); state.tab = "upstreams"; state.selUp = upstreamId; state.addUp = false; render(); toast("Added, with its route."); } catch (/** @type {any} */ e) { toast(e.message, "err"); } };
    const addChooser = () => providerAdd({
      canCancel: c.upstreams.length > 0,
      special: [
        ...(c.experimental?.cursorSdk === true ? [{ title: "Cursor (official SDK)", when: "Cursor's agent through @cursor/sdk with a Cursor API key.", note: "Adds the upstream and a cursor-sdk/* route.", action: () => viaTemplate("cursor-sdk", "cursor-sdk") }] : []),
        { title: "Qoder cloud", when: "Your Qoder account's cloud models (Qwen, Kimi, GLM, DeepSeek, MiniMax), browser login.", note: "Adds the upstream and a qd/* route.", action: () => viaTemplate("qoder-cloud", "qoder-cloud") },
        { title: "A coding agent on this machine", when: "Cursor CLI, Claude Code, Codex, Qoder CLI as the model: it edits files and runs commands itself.", note: "Pick it from the list below. Antigravity, which Filament downloads, installs from Settings › Coding agents in the harness.", action: () => document.querySelector("#agents-panel")?.scrollIntoView({ behavior: "smooth" }) },
      ],
    });
    // The catalogue also names each card's provider and plan (its badge and plan picker): read once, then drawn.
    if (!state._providers && !state._providersPending) state._providersPending = api("/providers").then((r) => { state._providers = r; if (state.tab === "upstreams") render(); }).catch(() => {}).finally(() => { state._providersPending = null; });
    // An API provider's card (Providers P1): who it is (the catalogue's name, its plan, its prefix, on or off), how it is
    // reached (plan or address, key, Test), its models, and everything else folded under Advanced.
    const providerCard = (u, i, { key, auth, typeSel, test, ovCount }) => {
      const known = providerFor(state._providers?.providers, u.baseUrl);
      const pr = prefixRouteOf(c, u.id);
      const prefix = pr ? pr.match.slice(0, -2) : "";
      const others = (c.routes || []).filter((r) => r !== pr && (r.upstream === u.id || (r.fallbacks || []).some((f) => f.upstream === u.id)));
      const on = h("input", { type: "checkbox" }); on.checked = u.enabled !== false; on.onchange = () => { u.enabled = on.checked; markDirty(); render(); };
      // The plan picker: another plan of the same provider is its address, the workspace kept; one that needs a field
      // this address does not hold says so (type the address under Advanced).
      const planSeg = known && known.provider.plans.length > 1 ? (() => { const fields = fieldsOf(known.plan.baseUrl, u.baseUrl); return h("div", { class: "row", style: "align-items:center" }, h("span", { class: "small" }, "plan "), h("div", { class: "seg" }, ...known.provider.plans.map((pl) => { const url = fillUrl(pl.baseUrl, fields); return h("button", { type: "button", class: pl.id === known.plan.id ? "active" : "", disabled: url == null ? "" : null, title: url == null ? `Needs its ${placeholders(pl.baseUrl).join(", ")}: type the whole address under Advanced` : url, onclick: () => { if (url == null || pl.id === known.plan.id) return; if ((u.modelsPath || "") === (known.plan.modelsPath || "")) u.modelsPath = pl.modelsPath || ""; u.baseUrl = url; markDirty(); render(); } }, pl.label); })), h("span", { class: "muted small" }, known.plan.billing === "plan" ? (known.provider.keyless ? "runs on this machine" : "a subscription") : "billed per token")); })() : null;
      // How it bills (Providers P4): a subscription's requests are paid $0 and keep their list price as analytics.
      const billingSeg = (() => {
        const b = billingAt(u, known);
        const pick = (/** @type {"metered" | "plan"} */ v) => { if (u.billing === v) return; u.billing = v; markDirty(); render(); };
        const why = b.source === "catalogue" ? `as its ${known?.plan.label || "catalogue"} address says` : b.source === "default" ? "nobody said, so per token" : "set here";
        return h("div", { class: "row", style: "align-items:center" }, h("span", { class: "small" }, "billing "),
          h("div", { class: "seg billing-seg", role: "group", "aria-label": "How this provider bills" },
            h("button", { type: "button", class: b.billing === "metered" ? "active" : "", title: "Each request is paid at this provider's list price", onclick: () => pick("metered") }, "Billed per token"),
            h("button", { type: "button", class: b.billing === "plan" ? "active" : "", title: "A subscription: requests are paid $0, and their list price is kept as analytics", onclick: () => pick("plan") }, "Subscription (plan)")),
          h("span", { class: "muted small" }, why),
          b.source === "upstream" ? h("button", { class: "sm ghost", title: "Forget the choice: the catalogue says, else per token", onclick: () => { u.billing = null; markDirty(); render(); } }, "automatic") : null);
      })();
      const prefixIn = h("input", { type: "text", class: "mono prefix-in", value: prefix, placeholder: u.id });
      prefixIn.onchange = () => { const v = prefixIn.value.trim(); if (v === prefix) return; const problem = prefixProblem({ upstreams: c.upstreams.filter((x) => x !== u), routes: (c.routes || []).filter((x) => x !== pr) }, v); if (problem) { prefixIn.value = prefix; return toast(problem, "err"); } pr.match = `${v}/*`; markDirty(); render(); };
      // Its own id is its natural prefix: only the other upstreams, and every route, can take one from it.
      const free = () => freePrefix({ upstreams: c.upstreams.filter((x) => x !== u), routes: c.routes || [] }, u.id);
      const addPrefix = () => { const p = free(); (c.routes ||= []).unshift({ match: `${p}/*`, upstream: u.id, upstreamModel: "{1}", format: "auto", fallbacks: [], discoverPrefixes: [], enabled: true, rules: {} }); markDirty(); toast(`Prefix route ${p}/* added. Press Save changes to use it.`); render(); };
      const prefixRow = h("div", { class: "row", style: "align-items:center" },
        pr ? h("label", {}, "prefix ", h("span", { class: "prefix-wrap" }, prefixIn, h("code", {}, "/"))) : h("span", { class: "small" }, "No prefix: nothing asks for its models as ", h("code", {}, `${u.id}/…`), ". "),
        pr ? h("span", { class: "muted small" }, "your tools ask for ", h("code", {}, `${prefix}/<model>`)) : h("button", { class: "sm", onclick: addPrefix }, `Add prefix ${free()}/`),
        others.length ? h("span", { class: "muted small" }, `Also reached by ${others.map((r) => r.match).join(", ")} (`, goto("routes", "Routes, advanced"), ")") : null);
      // A header whose value Filament keeps as a credential comes as the placeholder (redactConfig): its value shows as
      // stored, typed over to replace it. Its name stays while it is kept — the store finds a kept value by the name it
      // was stored under (mergeSecrets), and refuses a Save that holds it under another; a value typed first frees the name.
      const headersEd = (() => {
        const box = h("div", { class: "kv-edit" }); const pairs = Object.entries(u.headers || {}).map(([k, v]) => ({ name: k, value: String(v ?? ""), kept: v === "__SECRET__" }));
        const sync = () => { u.headers = Object.fromEntries(pairs.filter((p) => String(p.name).trim()).map((p) => [String(p.name).trim(), p.kept ? "__SECRET__" : p.value])); markDirty(); };
        const draw = () => box.replaceChildren(...pairs.map((pair, j) => { const k = h("input", { type: "text", class: "mono", value: pair.name, placeholder: "Header-Name" }); k.onchange = () => { if (pair.kept && k.value.trim() !== pair.name) { k.value = pair.name; return toast(keptHeaderWords(pair.name), "err"); } pair.name = k.value; sync(); }; const v = h("input", { type: pair.kept ? "password" : "text", class: "mono", value: pair.kept ? "" : pair.value, placeholder: pair.kept ? "stored, type to replace" : "value" }); v.onchange = () => { if (pair.kept && !v.value) return; pair.kept = false; pair.value = v.value; sync(); }; return h("div", { class: "row", style: "margin:0 0 4px" }, k, v, h("button", { class: "sm ghost", title: "Remove this header", onclick: () => { pairs.splice(j, 1); sync(); draw(); } }, "×")); }), h("button", { class: "sm ghost", onclick: () => { pairs.push({ name: "", value: "", kept: false }); draw(); } }, "+ header"));
        draw(); return box;
      })();
      const wire = u.type === "openai" || u.type === "openai-compatible" ? h("label", { title: "Which endpoint this server offers. auto: Chat Completions first, and /v1/responses when the server has no Chat Completions (404). responses: the server only speaks the OpenAI Responses API; Filament repacks requests and replies." }, "wire API ", (() => { const s = h("select", {}, ...[["auto", "auto (detect)"], ["chat-completions", "/v1/chat/completions"], ["responses", "/v1/responses only"]].map(([v, l]) => h("option", { value: v, selected: v === (u.wireApi || "auto") ? "" : null }, l))); s.onchange = () => { u.wireApi = s.value; markDirty(); }; return s; })()) : null;
      const discoverCb = (() => { const cb = h("input", { type: "checkbox" }); cb.checked = u.discoverModels !== false; cb.onchange = () => { u.discoverModels = cb.checked; markDirty(); }; return h("label", { class: "check", title: "Ask this provider for its model list (on Save and on Refresh) and advertise the names your routes can reach" }, cb, "discover models"); })();
      const extraIn = (() => { const i2 = h("input", { type: "text", value: (u.models || []).join(", ") }); i2.onchange = () => { u.models = i2.value.split(",").map((s) => s.trim()).filter(Boolean); markDirty(); }; return i2; })();
      // A key this secret.key cannot read is kept until one is typed in its place, or Remove forgets it at Save.
      const lost = unreadableOf(state.unreadable, u);
      const stored = !!(u.apiKey || u.apiKeyMasked);
      const added = state.justAdded?.id === u.id ? h("div", { class: "alert ok", style: "margin:0 0 10px" }, h("span", {}, h("b", {}, "Added. "), "Your tools can ask for ", h("code", {}, `${state.justAdded.prefix}/…`), " now; its models are listed below as soon as it answers.")) : null;
      return h("section", { class: "card wide provider-card" },
        h("div", { class: "card-head" }, h("h3", {}, u.name || u.id || "New provider"),
          h("span", { class: "pill", title: (types[u.type]?.label || u.type) }, known ? known.provider.name : "Custom"),
          known && known.provider.plans.length > 1 ? h("span", { class: "pill" }, known.plan.label) : null,
          prefix ? h("code", { title: "its prefix: your tools ask for its models as prefix/model" }, `${prefix}/`) : null,
          h("label", { class: "check", title: "Off: routes skip it and the next provider in a failover order is tried" }, on, u.enabled === false ? "disabled" : "enabled"),
          state.requests.some((r) => r.upstream === u.id && r.costSource === "provider") ? h("span", { class: "pill ok", title: "This provider states what it charged inside each reply; Filament records that exact figure." }, "exact charges") : null,
          h("span", { class: "muted small mono" }, u.baseUrl || "")),
        h("div", { class: "card-body" },
          added,
          unreadableNote(h, lost),
          h("h4", { class: "card-sec" }, "Connection"),
          planSeg,
          billingSeg,
          known ? null : h("div", { class: "row" }, h("label", { class: "grow" }, "base URL ", input(u, "baseUrl", types[u.type]?.baseUrl || "https://…"))),
          h("div", { class: "row", style: "align-items:flex-end" }, h("label", { class: "grow" }, known?.provider.keyless ? "API key (not needed) " : "API key ", key, stored ? h("button", { class: "sm ghost danger", title: lost.includes("apiKey") ? "Forget the stored key, which this secret.key cannot read; requests then go without one" : "Remove the stored key; requests then go without one", onclick: () => { u.apiKey = ""; u.apiKeyMasked = ""; key.value = ""; markDirty(); render(); } }, "remove") : null), test),
          prefixRow,
          h("h4", { class: "card-sec" }, "Models"),
          modelsPanel(u),
          h("details", { class: "subform provider-advanced" }, h("summary", {}, "Advanced (id, type, address, auth, wire API, models path, headers, rule overrides)"),
            h("div", { class: "prov-adv-body" },
              h("div", { class: "row" }, h("label", {}, "id ", idInput(u)), h("label", {}, "name ", input(u, "name", "Display name")), h("label", {}, "type ", typeSel)),
              known ? h("div", { class: "row" }, h("label", { class: "grow" }, "base URL ", input(u, "baseUrl", types[u.type]?.baseUrl || "https://…"))) : null,
              h("div", { class: "row" }, h("label", {}, "auth ", auth), wire, h("label", { class: "grow", title: "Blank: /v1/models, or /vN/models under the base's version when the base ends in one (…/v4 → /v4/models). A path or a full URL." }, "models path (blank = the base's /models) ", input(u, "modelsPath", "/v1/models"))),
              h("div", { class: "row" }, discoverCb, h("label", { class: "grow" }, "extra models to advertise (comma separated) ", extraIn)),
              h("div", {}, h("span", { class: "small" }, "extra headers"), headersEd),
              h("div", { class: "row" }, h("button", { title: "Rules are the fix/fill/remove settings from the Rules page. Everything there applies to all traffic; here you can change any of them for requests going to THIS provider only (for example force streaming on, or a different effort default). Fields left on “inherit” keep the global value.", onclick: () => openRulesDrawer(`Upstream ${u.id}: rule overrides`, u.rules || (u.rules = {}), mergedRules(c.rules), `Only traffic to ${u.name || u.id}`) }, ovCount ? `rule overrides (${ovCount} set)` : "rule overrides for this provider")),
              h("p", { class: "muted small" }, `Formats: ${(types[u.type]?.formats || []).join(", ")}.`))),
          h("div", { class: "row" }, h("span", { class: "grow" }), h("button", { class: "danger", onclick: () => removeUpstream(c, u, i) }, "Remove"))));
    };
    // Another machine's models (the remote-agents plan's m-ui): read here, never edited. Its machine's address,
    // certificate and token are this Filament's machine store's, never config.json's, and it is added and removed by
    // Settings › Remote access's switch in the app — so it is no type to pick on a card either.
    const machineCard = (u) => {
      const pr = prefixRouteOf(c, u.id);
      const prefix = pr ? pr.match.slice(0, -2) : "";
      const name = u.name || u.id;
      return h("section", { class: "card wide machine-card", "data-machine": u.machine || "" },
        h("div", { class: "card-head" }, h("h3", {}, name),
          h("span", { class: "pill", title: types[u.type]?.label || u.type }, "Another machine"),
          prefix ? h("code", { title: "its prefix: your tools ask for its models as prefix/model" }, `${prefix}/`) : null,
          u.enabled === false ? h("span", { class: "pill warn" }, "disabled") : h("span", { class: "pill ok" }, "enabled")),
        h("div", { class: "card-body" },
          h("p", {}, `${name}'s models, through this Filament's agents' device there: they run on ${name}'s keys and sign-ins, and each call goes there.`),
          h("p", { class: "muted small" }, `Its address, certificate and token are kept in this Filament's machine store, never in this configuration. It is switched on and off in the app's Settings › Remote access › Machines: the Models pill under "What this machine may do on ${name}".`),
          h("p", { class: "muted small mono" }, `machine ${u.machine || "?"}`)));
    };
    c.upstreams.forEach((u, i) => {
      if (u.id !== state.selUp) return;
      if (types[u.type]?.machine) return void list.append(machineCard(u));
      // A machine's models come from Settings › Remote access alone: never a type to pick here (it needs a kept machine).
      const typeSel = h("select", {}, ...Object.entries(types).filter(([k, v]) => !v.machine || k === u.type).map(([k, v]) => h("option", { value: k, selected: k === u.type ? "" : null }, v.label)));
      // From one kind of coding agent to another, the command is the new kind's own (Codex runs `codex app-server`).
      typeSel.onchange = () => { const was = types[u.type]; u.type = typeSel.value; const t = types[u.type]; if (!u.baseUrl || Object.values(types).some((x) => x.baseUrl === u.baseUrl)) u.baseUrl = t.baseUrl; if (t.agent && was?.agent && t !== was) { const d = state.schema.upstream.acp; u.acp = { ...u.acp, command: t.agentDefaults?.command ?? d.command.default, args: t.agentDefaults?.args ?? d.args.default }; } markDirty(); render(); };
      const auth = h("select", {}, ...["auto", "x-api-key", "bearer", "both"].map((a) => h("option", { value: a, selected: a === (u.authStyle || "auto") ? "" : null }, a))); auth.onchange = () => { u.authStyle = auth.value; markDirty(); };
      const lost = unreadableOf(state.unreadable, u);
      const kept = u.apiKey === "__SECRET__";
      const key = h("input", { type: "password", value: kept ? "" : u.apiKey || "", placeholder: kept ? (lost.includes("apiKey") ? "stored, unreadable here: type a key to replace it" : `stored (${u.apiKeyMasked || "••••"}), type to replace`) : "paste key" }); key.onchange = () => { u.apiKey = key.value || (kept ? "__SECRET__" : ""); markDirty(); };
      // The test answers with the names the provider listed (Providers F2): drawn under the button's row, so the person sees
      // the models before anything is saved.
      const testNames = h("div", { class: "chips-wrap test-names", style: "margin:6px 0 0" });
      const showNames = (/** @type {string[]} */ names, /** @type {number | null} */ total) => testNames.replaceChildren(names.length ? h("span", { class: "muted small" }, "It lists: ") : "", ...names.slice(0, 60).map((n) => h("code", { class: "chip" }, n)), (total ?? names.length) > 60 ? h("span", { class: "muted small" }, ` +${(total ?? names.length) - 60} more`) : "");
      const test = h("button", { title: "Tests with the values currently in this form, saved or not. Press Save to keep them.", onclick: async (e) => { e.target.textContent = "testing…"; if (!testNames.isConnected) e.target.closest(".row")?.after(testNames); showNames([], 0); try { const r = await api(`/upstreams/test`, { method: "POST", body: { upstream: u } }); e.target.textContent = r.ok ? `ok (${r.status}, ${r.ms} ms${r.models != null ? `, ${r.models} models` : ""})${state.dirty ? " — unsaved, press Save" : ""}` : `failed: ${r.error || `HTTP ${r.status}`}${r.sample ? " " + r.sample.slice(0, 120) : ""}`; if (r.ok) showNames(r.names || [], r.models); } catch (/** @type {any} */ err) { e.target.textContent = `error: ${err.message}`; } } }, "Test connection");
      const ovCount = Object.keys(flatten(u.rules || {})).length;
      const isAcp = u.type === "acp"; const isCodex = u.type === "codex"; const isSdk = u.type === "cursor-sdk"; const isAgent = !!types[u.type]?.agent;
      if (isAgent && !u.acp) u.acp = {};
      const isQoder = u.type === "qoder";
      if (isQoder && !u.qoder) u.qoder = { authMethod: "device" };
      const qoderPanel = isQoder ? (() => {
        const box = h("div", { class: "qoder-box" }, h("span", { class: "muted small" }, "checking login…"));
        const draw = async () => {
          if (!u.id) return box.replaceChildren(h("span", { class: "muted small" }, "Save the upstream first, then log in."));
          let s; try { s = await api(`/qoder/${encodeURIComponent(u.id)}/status?quota=1`); } catch (/** @type {any} */ e) { return box.replaceChildren(h("span", { class: "muted small" }, "Save the upstream (press Save changes), then log in here.")); }
          const loginBtn = h("button", { class: "primary sm", onclick: async () => {
            if (state.dirty && !confirm("You have unsaved changes. Logging in stores the login on the server and reloads the saved configuration, which discards them. Continue?")) return;
            loginBtn.disabled = true; loginBtn.textContent = "waiting for the browser…";
            try {
              const st = await api(`/qoder/${encodeURIComponent(u.id)}/login/start`, { method: "POST" });
              const win = window.open(st.url, "_blank", "noopener,noreferrer");
              if (!win) toast("Popup blocked: open this URL manually: " + st.url, "err");
              const started = Date.now();
              const tick = async () => {
                if (Date.now() - started > 310000) { loginBtn.disabled = false; loginBtn.textContent = "Log in with Qoder"; return toast("Login timed out; try again", "err"); }
                let p; try { p = await api(`/qoder/${encodeURIComponent(u.id)}/login/poll`, { method: "POST", body: { nonce: st.nonce } }); }
                catch (/** @type {any} */ e) { if (/not found|unknown|expired/i.test(e.message)) { loginBtn.disabled = false; loginBtn.textContent = "Log in with Qoder"; return toast(e.message, "err"); } return setTimeout(tick, 3000); } // a hiccup: keep polling
                if (p.status === "pending") return setTimeout(tick, 2000);
                if (p.status === "ok") { toast(`Logged in as ${p.email || p.userId}`); await loadSavedAndGo(); return; }
                loginBtn.disabled = false; loginBtn.textContent = "Log in with Qoder"; toast(p.error || p.status, "err");
              };
              setTimeout(tick, 2000);
            } catch (/** @type {any} */ e) { loginBtn.disabled = false; loginBtn.textContent = "Log in with Qoder"; toast(e.message, "err"); }
          } }, "Log in with Qoder");
          const q = s.quota && !s.quota.error ? s.quota : null;
          box.replaceChildren(
            h("div", { class: "row", style: "margin:0" },
              s.loggedIn ? h("span", { class: `pill ${s.expired ? "err" : "ok"}` }, s.expired ? "login expired" : s.method === "pat" ? "personal token" : `logged in${s.email ? " · " + s.email : ""}`) : h("span", { class: "pill warn" }, "not logged in"),
              s.expiresAt ? h("span", { class: "muted small" }, `token valid until ${new Date(s.expiresAt).toLocaleDateString()}`) : null,
              q ? h("span", { class: "muted small" }, `credits: ${fmt.n(q.user.used)} used of ${fmt.n(q.user.total)}${q.resetsAt ? `, resets ${new Date(q.resetsAt).toLocaleDateString()}` : ""}${q.exceeded ? " · QUOTA EXCEEDED" : ""}`) : null,
              h("span", { class: "grow" }), loginBtn, s.loggedIn ? h("button", { class: "sm", title: "Forgets the browser login and any pasted personal token", onclick: () => api(`/qoder/${encodeURIComponent(u.id)}/logout`, { method: "POST" }).then(() => loadSavedAndGo()) }, "Log out") : null),
            h("p", { class: "muted small", style: "margin:8px 0 0" }, "Two ways to authenticate: the browser login (your Qoder account, valid about 30 days), or a personal token from qoder.com → Account → Integrations (qoder.cn in China) pasted below as the API key (starts with pt-). For a qoder.cn account, set region to china under “Account settings” first — the login page and every request follow it. Uses your Qoder credits; models come from your account's list."));
        };
        draw(); return box;
      })() : null;
      const acpTest = h("button", { title: "Starts the agent, opens a throwaway session and reports what it offers.", onclick: async (e) => { e.target.textContent = "testing (starts the agent)…"; try { const r = await api(`/upstreams/test`, { method: "POST", body: { upstream: u } }); const who = r.profile?.agent ? `${r.profile.agent.title || r.profile.agent.name}${r.profile.agent.version ? ` ${r.profile.agent.version}` : ""} · ` : ""; e.target.textContent = r.ok ? `ok · ${who}${r.command} · auth ${r.auth} · ${r.models ?? "?"} models · modes ${(r.modes || []).join("/")} (${r.ms} ms)` : `failed: ${r.error}`; } catch (/** @type {any} */ err) { e.target.textContent = `error: ${err.message}`; } } }, "Test agent");
      if (!isAgent && !isQoder) return void list.append(providerCard(u, i, { key, auth, typeSel, test, ovCount }));
      list.append(h("section", { class: "card wide" },
        h("div", { class: "card-head" }, h("h3", {}, u.name || u.id || "New upstream"), h("span", { class: "pill" }, isAcp ? "ACP agent" : isSdk ? "Cursor SDK" : isQoder ? "Qoder cloud" : (types[u.type]?.label || u.type).replace(/ \(.*\)$/, "")), u.enabled === false ? h("span", { class: "pill warn" }, "disabled") : h("span", { class: "pill ok" }, "enabled"), state.requests.some((r) => r.upstream === u.id && r.costSource === "provider") ? h("span", { class: "pill ok", title: "This provider states what it charged inside each reply; Filament records that exact figure." }, "exact charges") : null, h("span", { class: "muted small mono" }, isAcp || isCodex ? `${u.acp.command || "agent"} ${(u.acp.args || ["acp"]).join(" ")}` : isSdk ? `@cursor/sdk · ${u.apiKey ? "API key set" : "no API key yet"}` : isQoder ? (u.qoder?.email || "account login") : u.baseUrl || "")),
        h("div", { class: "card-body" },
        h("div", { class: "row" }, h("label", {}, "id ", idInput(u)), h("label", {}, "name ", input(u, "name", "Display name")), h("label", {}, "type ", typeSel), (() => { const on = h("input", { type: "checkbox" }); on.checked = u.enabled !== false; on.onchange = () => { u.enabled = on.checked; markDirty(); }; return h("label", { class: "check" }, on, "enabled"); })()),
        unreadableNote(h, lost),
        isQoder ? qoderPanel : null,
        isQoder ? h("details", { class: "subform" }, h("summary", {}, "Account settings (deployment region, tokens, expiry)"), schemaForm(state.schema.upstream.qoder, u.qoder, () => markDirty(), { compact: true })) : null,
        isQoder ? h("div", { class: "row" }, h("label", { class: "grow" }, "personal token (pt-…), optional alternative to the login ", key, u.apiKey || u.apiKeyMasked ? h("button", { class: "sm ghost danger", title: "Remove the stored personal token; the browser login (or a fresh token) is used afterwards", onclick: () => { u.apiKey = ""; key.value = ""; markDirty(); } }, "remove") : null)) : null,
        isSdk ? h("div", { class: "row" }, h("label", { class: "grow" }, "Cursor API key (cursor.com/dashboard → Integrations → API keys; a user key bills your Cursor plan like the IDE does) ", key)) : null,
        isAgent ? null : h("div", { class: "row" }, h("label", { class: "grow" }, "extra headers (JSON) ", (() => { const ta = h("input", { type: "text", class: "mono", value: JSON.stringify(u.headers || {}) }); ta.onchange = () => { try { const next = JSON.parse(ta.value || "{}"); const moved = placeholderMoved(next, u.headers); if (moved.length) { ta.value = JSON.stringify(u.headers || {}); return toast(`${moved.join(", ")}: __SECRET__ stands for a value stored under the header's own name, and this name has none. Write its value instead, or keep the name it had`, "err"); } u.headers = next; markDirty(); } catch { toast("Invalid JSON", "err"); } }; return ta; })())),
        isAgent ? h("div", { class: "row" }, (() => { const cb = h("input", { type: "checkbox" }); cb.checked = u.discoverModels !== false; cb.onchange = () => { u.discoverModels = cb.checked; markDirty(); }; return h("label", { class: "check", title: "Ask the agent for its model list (Cursor: agent --list-models) and advertise them under this upstream's routes" }, cb, "discover models from the agent"); })(), h("label", { class: "grow" }, "extra models to advertise (comma separated) ", (() => { const i2 = h("input", { type: "text", value: (u.models || []).join(", ") }); i2.onchange = () => { u.models = i2.value.split(",").map((s) => s.trim()).filter(Boolean); markDirty(); }; return i2; })()))
          : h("div", { class: "row" }, (() => { const cb = h("input", { type: "checkbox" }); cb.checked = u.discoverModels !== false; cb.onchange = () => { u.discoverModels = cb.checked; markDirty(); }; return h("label", { class: "check", title: "Ask this upstream for its model list and advertise the names your routes can reach" }, cb, "discover models"); })(), h("label", { title: "Blank: /v1/models, or /vN/models under the base's version when the base ends in one (…/v4 → /v4/models). A path or a full URL." }, "models path (blank = the base's /models) ", input(u, "modelsPath", "/v1/models")), h("label", { class: "grow" }, "extra models to advertise (comma separated) ", (() => { const i2 = h("input", { type: "text", value: (u.models || []).join(", ") }); i2.onchange = () => { u.models = i2.value.split(",").map((s) => s.trim()).filter(Boolean); markDirty(); }; return i2; })())),
        isAgent ? h("details", { class: "subform" }, h("summary", {}, isSdk ? "Agent settings (permissions, working directory, client bridge, how thinking and tools are shown)" : "Agent settings (command, permissions, working directory, how thinking and tools are shown)"), schemaForm(state.schema.upstream.acp, u.acp, () => markDirty(), { skip: types[u.type]?.unused || [] }),
          // §10 asks for the bridge modes to be explained prominently, not only in a tooltip on one column: this is
          // the setting that decides whether your chat client renders the agent's work as its own native cards or
          // reads it as narration, and the four values are not obvious from their names. Built from the same
          // BRIDGE_HINT map the Agents page uses, so the two surfaces cannot drift apart.
          h("div", { class: "card", style: "margin:10px 0 0" },
            h("h4", {}, "What clientBridge does"),
            h("ul", { class: "small", style: "margin:6px 0 0" }, ...bridgeModes(state.schema).map((m) => h("li", { style: "margin:0 0 6px" },
              h("code", {}, m), " — ", BRIDGE_HINT[m] || "no explanation recorded for this mode yet — see acp.clientBridge in Settings → Parameters.",
              m === "native" ? h("span", { class: "muted" }, " Only an agent that can switch its built-in tools off honours this (Claude Code, or one with nativeTools set); any other agent behaves as full, and the Agents page says so.") : null,
              m === "full" ? h("span", { class: "muted" }, " A client with no such tools gets Filament's own hands instead, under this upstream's permission policy; each delegation and who ran it is listed on the request record's Changes.") : null,
            ))),
            u.acp?.clientBridge === "native"
              ? h("p", { class: "muted small", style: "margin:8px 0 0" }, "With this mode, each read and command lands in two histories — your client's and the agent's. Result paging caps what goes back to the agent (", h("code", {}, "nativePaging"), ", ", h("code", {}, "nativePageLines"), ", ", h("code", {}, "nativePageChars"), ") so the duplication costs less than a second full copy; your client keeps everything.")
              : u.acp?.clientBridge === "full"
                // Honest about the gap rather than implying a knob does something it does not: `full` delegates over
                // ACP's own fs/terminal methods, which bypass Filament's toolset and so are not paged.
                ? h("p", { class: "muted small", style: "margin:8px 0 0" }, "With this mode the agent delegates over ACP's own file and terminal methods and gets those results whole — result paging does not apply to it yet. Each delegation, and whether your client or Filament's own hands ran it, is listed on the request record's Changes.")
                : null)) : null,
        (isAcp || isCodex) && u.id ? agentGuide(u) : null,
        isSdk ? sdkPanel(u) : null,
        u.id ? modelsPanel(u) : null,
        h("div", { class: "row" }, isAgent ? acpTest : test, h("button", { title: "Rules are the fix/fill/remove settings from the Rules page. Everything there applies to all traffic; here you can change any of them for requests going to THIS upstream only (for example force streaming on, or a different effort default). Fields left on “inherit” keep the global value.", onclick: () => openRulesDrawer(`Upstream ${u.id}: rule overrides`, u.rules || (u.rules = {}), mergedRules(c.rules), `Only traffic to ${u.name || u.id}`) }, ovCount ? `rule overrides (${ovCount} set)` : "rule overrides for this upstream"), h("span", { class: "grow" }), h("button", { class: "danger", onclick: () => removeUpstream(c, u, i) }, "Remove")),
        h("p", { class: "muted small" }, isQoder ? "Qoder's cloud models (Qwen, Kimi, GLM, DeepSeek, MiniMax and Qoder's own tiers) through your Qoder account, using Qoder's own signed protocol; plain chat with tools, no agent. Anthropic-format clients are translated automatically." : isAcp ? "A local coding agent driven over the Agent Client Protocol. It runs its own tools in the project folder taken from the client's request; Filament relays the conversation and shows the agent's reply as a normal model answer. Cursor: install the CLI and run `agent login` once." : isCodex ? "OpenAI's Codex, driven over its own app-server. It runs its own tools in the project folder taken from the client's request; Filament relays the conversation and draws its work. Sign in once with `codex login` (your ChatGPT plan)." : `Formats: ${(types[u.type]?.formats || []).join(", ")}.`))));
    });
    const typeRow = (t, when, note) => h("tr", {}, h("td", {}, h("b", {}, t)), h("td", { html: md(when) }), h("td", { class: "muted", html: md(note) }));
    return h("div", {},
      intro("upstreams",
        h("p", {}, "An upstream is a place Filament can forward to: a provider's API, a coding agent, or Qoder. ", h("b", {}, "+ Add"), " picks a provider, takes its key and lists its models before anything is saved; your tools then ask for them as ", h("code", {}, "prefix/model"), " (", h("code", {}, "zai/glm-5"), "). Other routing — bare names, rewrites, failover — is on Routes (advanced)."),
        h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, h("th", {}, "type"), h("th", {}, "pick it when"), h("th", {}, "notes"))), h("tbody", {},
          typeRow("OpenAI-compatible", "GLM, DeepSeek, Kimi, Groq, LM Studio, Ollama, or anything with `/v1/chat/completions`.", "Thinking and effort rules are Claude-specific and are skipped here."),
          typeRow("Anthropic-compatible", "Any other server that implements `/v1/messages`.", "Some proxies and gateways."),
          typeRow("OpenAI API", "You forward straight to api.openai.com with your own key.", "Auth uses `Authorization: Bearer`. Chat Completions, embeddings and, through Filament, the Responses API."),
          typeRow("Anthropic API", "You forward straight to api.anthropic.com with your own key.", "Auth uses `x-api-key`. Adds `?beta=true` for the newest features."),
          typeRow("ACP agent", "You want a whole coding agent (Cursor CLI, Claude Code, Antigravity, Qoder CLI) to act as the model: it edits files and runs commands itself, in the project folder your client is working in.", "No URL or key: Filament starts the agent locally. Route `cursor/*` -> `{1}` exposes every Cursor model. Install its CLI and log in once; Antigravity installs and signs in on its card in Settings → Coding agents."),
          typeRow("Codex", "You want OpenAI's Codex to act as the model, on your ChatGPT plan.", "No URL or key: Filament starts `codex app-server` locally. Route `codex/*` -> `{1}` exposes every Codex model with its efforts. Sign in once with `codex login`."),
          typeRow("Cursor SDK", "You want Cursor's agent through its official SDK, a second way beside its CLI.", "Experimental, and off until you turn it on in Settings › Experimental. Its account signs in under Settings → Coding agents, on Cursor's page or with a Cursor API key; see “Cursor, and its SDK behind Experimental” in the guide."),
          typeRow("Qoder cloud", "You have a Qoder account and want its cloud models (Qwen, Kimi, GLM, DeepSeek, MiniMax…) as plain chat models.", "No URL. Log in with the button on the card, or paste a personal token (pt-…). Route `qd/*` -> `{1}`. Speaks OpenAI shapes; Anthropic clients are translated.")))),
        h("ul", { class: "small", style: "margin-top:10px" }, h("li", {}, "Test connection uses the values in the form even before saving. Green means the address and key work. Press Save changes to keep them."), h("li", { html: md("**discover models** asks the provider for its `/v1/models` list when it is added or its address, key or auth changes, and when you press Refresh, so agents with a model picker see real names. Turn it off (under Advanced) for servers that have no such endpoint.") }), h("li", { html: md("**rule overrides** change how requests to this upstream are shaped, e.g. force streaming on for Anthropic, or add cache markers.") }))),
      h("div", { class: "conn" }, rail, h("div", { class: "conn-main" },
      state.addUp || !c.upstreams.length ? addChooser() : list,
      !(state.addUp || !c.upstreams.length) ? null : h("section", { class: "panel", id: "agents-panel" }, h("h2", {}, "Coding agents on this machine"), h("p", { class: "muted small" }, "Coding agents can act as models: Codex over its app-server, the others over the Agent Client Protocol. Filament knows these; a fresh install turns on Claude Code, Codex and Cursor where they are installed and adds the others off, to turn on in Settings → Coding agents. “Detect” adds any that are missing and turns on those three once installed."),
        h("div", { class: "intro-body", style: "border:1px solid var(--line);border-radius:var(--r-sm);padding:10px 14px;margin:0 0 12px;background:var(--surface-2)" }, h("p", { style: "margin:0 0 4px" }, h("b", {}, "Using a Claude or ChatGPT subscription. "), "Anthropic and OpenAI only allow their consumer subscriptions to be used through their own tools, and both block or forbid third-party clients that log in with the subscription directly. Filament therefore does not imitate those tools. Instead it runs the official tool itself as an agent: ", h("b", {}, "Claude Code"), " (Claude Pro/Max, ", h("code", {}, "claude auth login"), ") and ", h("b", {}, "Codex"), " (ChatGPT Plus/Pro/Team, ", h("code", {}, "codex login"), "). Press Log in once, then ask for ", h("code", {}, "claude-code/…"), " or ", h("code", {}, "codex/…"), " model names. Pay-per-token API keys still go on a normal Anthropic or OpenAI-compatible upstream.")), (() => {
        const box = h("div", {}, h("span", { class: "muted" }, "checking…"));
        // An agent on by default is turned on by Detect; another by its Connect, in the harness.
        const loginBtn = (a) => { const name = a.name.replace(" (agent via ACP)", ""); return h("button", { class: "sm", title: `Opens a terminal window that signs you in to ${name}. Finish the sign-in there (browser or code).`, onclick: async (e) => { e.target.disabled = true; try { const d = await api(`/acp/agents/${encodeURIComponent(a.id)}/login`, { method: "POST" }); toast(d?.ok === false ? `Run this in a terminal: ${d.command}` : `A terminal window opened for ${name}. Finish the sign-in there, then ${a.onByDefault ? "press “Detect installed agents”" : `turn ${name} on with Connect in the harness's Settings → Coding agents`}.`); } catch (/** @type {any} */ err) { toast(err.message, "err"); } e.target.disabled = false; } }, "Log in"); };
        const load = () => api("/acp/agents").then((r) => box.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["agent", "what pays for it", "installed", "login", "in your config"].map((x) => h("th", {}, x)))), h("tbody", {}, ...r.agents.map((a) => h("tr", {}, h("td", {}, h("b", {}, a.name.replace(" (agent via ACP)", "")), h("div", { class: "muted small" }, a.notes), a.installed || !a.install ? null : h("div", { class: "small" }, "Install: ", h("code", {}, a.install))), h("td", { class: "small" }, a.account || "–"), h("td", {}, a.installed ? h("span", { class: "pill ok" }, "yes") : h("span", { class: "pill" }, "no")), h("td", {}, a.installed ? h("div", { class: "row", style: "margin:0;gap:6px;align-items:center" }, a.loggedIn === true ? h("span", { class: "pill ok" }, "logged in") : a.loggedIn === false ? h("span", { class: "pill err" }, "not logged in") : h("span", { class: "pill", title: "This agent does not report its login state; if requests fail, log in again." }, "unknown"), a.login ? loginBtn(a) : null) : h("span", { class: "muted small" }, "install first")), h("td", {}, a.configured ? h("span", { class: `pill ${a.enabled ? "ok" : ""}` }, a.enabled ? "enabled" : "disabled") : h("span", { class: "pill warn" }, "missing"))))))), h("div", { class: "toolbar", style: "margin-top:10px" }, h("button", { class: "sm", onclick: async () => { const d = await api("/acp/detect", { method: "POST" }); toast(`Detect: added ${d.added.length}, enabled ${d.enabled.length}`); await loadSavedAndGo(); } }, "Detect installed agents"), h("span", { class: "muted small" }, `Adds the agents missing from your config as a fresh install does, and turns on ${r.agents.filter((a) => a.onByDefault).map((a) => a.name.replace(" (agent via ACP)", "")).join(", ")} where installed, except one turned off in the harness's Settings → Coding agents. Another agent is turned on there, with its Connect. Never turns anything off.`)))).catch((e) => box.replaceChildren(h("span", { class: "err" }, e.message)));
        load(); return box; })()),
      !(state.addUp || !c.upstreams.length) ? null : h("section", { class: "panel" }, h("h2", {}, "Coming from 9router?"), h("p", { class: "muted small" }, "Filament can read the connections stored by a local 9router install and import what has an equivalent here: your Anthropic API key and your Qoder account login. Read-only; 9router is not changed and nothing you already have in Filament is overwritten."), (() => {
        const box = h("div", {}, h("span", { class: "muted small" }, "looking for a 9router database…"));
        api("/migrate/9router").then((r) => {
          if (!r.found) return box.replaceChildren(h("span", { class: "muted small" }, `No 9router database found (${r.path}).`));
          if (r.error) return box.replaceChildren(h("span", { class: "err small" }, r.error));
          box.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["provider", "auth", "account", "active"].map((x) => h("th", {}, x)))), h("tbody", {}, ...r.connections.map((c2) => h("tr", {}, h("td", {}, c2.provider), h("td", {}, c2.authType), h("td", {}, c2.email || c2.name || "–"), h("td", {}, c2.active ? "yes" : "no")))))), h("div", { class: "toolbar", style: "margin-top:10px" }, h("button", { class: "sm", onclick: async () => { const d = await api("/migrate/9router", { method: "POST", body: {} }); toast("Imported: " + d.report.map((x) => `${x.provider} ${x.action}`).join("; ")); await loadSavedAndGo(); } }, "Import into Filament"), h("span", { class: "muted small" }, "Anthropic key → anthropic upstream (only if it has none). Qoder login → qoder-cloud upstream + qd/* route.")));
        }).catch((e) => box.replaceChildren(h("span", { class: "err small" }, e.message)));
        return box; })()),
      )));
}

export function models() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester, modelCatalog,
    failoverRows, failoverSentence, flowDiagram, cmpTable, section, bridgeModes,
    BRIDGE_HINT, FAIL_CAUSES, STRATEGIES, qs,
    rx, bare, setStatus, loadAll, loadSavedAndGo, loadRequests,
    loadOps, hashFor, startLiveTicker, requestsTable,
    opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten, mergedRules, input,
    idInput, pingResult, memStatus, memAgo, memWhen, memBytes,
    memPrefix, memEnginePill, memKindPill, memLineageSvg, memSessionLink, memOffPanel,
    memGate, memJobPanel, memBackupsPanel, memImportPanel, memBackfillControl, memResultsTable,
    memSummary, commandsDoc, memKnewCard,
    memTimelineCard, memBenchmarkPanels, fmt, h, store, md,
    mdDoc, mdBlock, esc, setHtml, statusPill, phaseOf,
  } = /** @type {any} */ (ui);


    const c = state.config; const M = (state.catalog ||= { q: "", agents: false, multi: false });
    const box = h("div", {}, h("span", { class: "muted small" }, "loading models and usage…"));
    const upOf = (id) => c.upstreams.find((u) => u.id === id);
    const d0 = new Date(); d0.setDate(d0.getDate() - 29); const from = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;
    const results = {}; let data = null;
    // The list is cached in state and reused on every visit: opening the page must not re-ask every upstream
    // (that is seconds of waiting for hundreds of names). Only the Refresh button forces a real discovery pass.
    const load = (force = false) => {
      const want = force || !M.cache ? api(force ? "/models?refresh=1" : "/models") : Promise.resolve(M.cache);
      return Promise.all([want, api(`/usage/days?from=${from}`)]).then(([m, u]) => {
        M.cache = m; M.at = Date.now();
        const use = new Map(); for (const row of u.total?.rows || []) use.set(`${row.upstream}|${row.model}`, row);
        data = { models: m.models.filter((x) => x.source !== "effort-variant"), families: m.families || [], use }; draw();
      }).catch((e) => box.replaceChildren(h("span", { class: "err small" }, e.message)));
    };
    const ping = async (id) => { results[id] = null; draw(); try { results[id] = await api("/models/ping", { method: "POST", body: { model: id } }); } catch (/** @type {any} */ e) { results[id] = { ok: false, error: e.message }; } draw(); };
    const draw = () => {
      if (!data) return;
      // One group per model (Providers P2): each provider's family of it — its variant ids folded in, as the harness's
      // picker shows them — joined across providers by the model's own name (glm-5 at Z.AI and through OpenRouter are
      // one model, two lines). A family's numbers are its ids' added up; its speeds and cache hit, weighted by requests.
      const rowById = new Map(data.models.map((x) => [x.id, x]));
      const groups = new Map();
      for (const f of data.families) {
        const u = upOf(f.upstream); if (!u) continue; if (!M.agents && isAgentUp(u)) continue;
        const rows = f.members.map((x) => rowById.get(x.id)).filter(Boolean); if (!rows.length) continue;
        const lead = rows.find((r) => r.id === f.id) || rows[0];
        const uses = rows.map((r) => data.use.get(`${r.upstream}|${r.upstreamModel}`)).filter(Boolean);
        const req = uses.reduce((a, r) => a + (r.requests || 0), 0);
        const avg = (k) => { let n = 0, sum = 0; for (const r of uses) if (r[k] != null && r.requests) { n += r.requests; sum += Number(r[k]) * r.requests; } return n ? sum / n : null; };
        const spend = uses.reduce((a, r) => ({ cost: a.cost + (r.cost || 0), costN: a.costN + (r.costN || 0), listCost: a.listCost + (r.listCost || 0), listCostN: a.listCostN + (r.listCostN || 0) }), { cost: 0, costN: 0, listCost: 0, listCostN: 0 });
        const said = String(f.id).split("/").pop() || f.id; const key = normPrice(said);
        const g = groups.get(key) || { key, names: new Map(), lines: [] };
        g.names.set(said, (g.names.get(said) || 0) + 1);
        g.lines.push({ f, u, lead, rows, req, tps: avg("avgTps"), ttft: avg("avgTtftMs"), hit: avg("cacheHitRate"), spend });
        groups.set(key, g);
      }
      let list = [...groups.values()].map((g) => ({ ...g, display: [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0], providers: new Set(g.lines.map((l) => l.u.id)).size, req: g.lines.reduce((a, l) => a + l.req, 0) }));
      const q = M.q.trim().toLowerCase(); if (q) list = list.filter((g) => g.display.toLowerCase().includes(q) || g.lines.some((l) => l.rows.some((r) => r.id.toLowerCase().includes(q)) || (l.u.name || l.u.id).toLowerCase().includes(q)));
      if (M.multi) list = list.filter((g) => g.providers > 1);
      list.sort((a, b) => Number(b.providers > 1) - Number(a.providers > 1) || b.req - a.req || a.display.localeCompare(b.display));
      const num = (v, t) => h("td", { class: "num", title: t || null }, v);
      const rows = list.slice(0, 400).flatMap((g) => [h("tr", { class: "cat-group", "data-model": g.key }, h("td", { colspan: 11 }, h("b", {}, g.display), h("span", { class: "muted small" }, ` · ${g.providers} provider${g.providers === 1 ? "" : "s"}${g.req ? ` · ${fmt.n(g.req)} request${g.req === 1 ? "" : "s"} in 30 days` : ""}`))),
        ...g.lines.sort((a, b) => b.req - a.req).map((l) => { const { f, u, lead } = l; const r = results[lead.id]; const pr = f.price || null; const agent = isAgentUp(u);
          const win = familyWindowWords(f.window, { standard: lead.context_window });
          return h("tr", { class: "cat-line", "data-family": f.id }, h("td", {}, h("b", {}, (u.name || u.id).replace(" (agent via ACP)", "")), h("div", { class: "muted small" }, kindOf(u))),
            h("td", {}, h("button", { class: `model-btn ${r === null ? "pinging" : r ? (r.ok ? "ok" : "bad") : ""}`, title: `${lead.id}: the name your tool asks for; click to ping it`, onclick: () => ping(lead.id) }, h("code", {}, f.id)), f.members.length > 1 ? h("span", { class: "muted small", title: f.members.map((x) => x.id).join("\n") }, ` · ${f.members.length} ids`) : null, f.kind === "other" ? h("span", { class: "pill", title: "An embedding, rerank, speech or image model: never in chat pickers" }, "not for chat") : null, r === null ? h("span", { class: "muted small" }, " pinging…") : r ? h("span", { class: "ping-out" }, " ", pingResult(r)) : null),
            num(l.req ? fmt.n(l.req) : "–", "requests in the last 30 days, its ids added up"), num(l.tps != null ? Math.round(l.tps * 10) / 10 : "–", "average output tokens per second"), num(l.ttft != null ? fmt.ms(l.ttft) : "–", "average time to the first byte"), num(l.req ? fmt.pct(l.hit) : "–", "cache hit rate"),
            num(win, win !== "–" ? `context window${win.includes("·") ? "s" : ""}: ${win} — requests are judged against the standard one, /autofit fits a session to it, and a summary's slices are sized from it` : "no context window recorded: tune the model on its upstream card"),
            num(agent ? "plan" : pr ? `${fmtPrice(pr.input)} / ${fmtPrice(pr.output)}` : "–", agent ? "paid by the agent's plan" : pr ? "list price in / out per million tokens; Tune → Pricing on the upstream card sets it" : "no list price known: Tune → Pricing on the upstream card adds one"),
            num(l.spend.costN ? fmt.usd(l.spend.cost) : "–", "paid in the last 30 days: $0 on a plan"),
            num(l.spend.listCostN ? fmt.usd(l.spend.listCost) : "–", l.spend.listCostN ? "the same 30 days' tokens at the list price" : "no list figure: no price card"),
            h("td", { class: "acts" }, h("a", { href: "#destinations:upstreams", class: "golink small", onclick: (e) => { e.preventDefault(); state.selUp = u.id; state.addUp = false; go("upstreams"); } }, "card →"))); })]);
      box.replaceChildren(list.length ? h("div", { class: "table-wrap" }, h("table", { class: "small catalog-table" }, h("thead", {}, h("tr", {}, ...["provider", "name your tool asks for", "30-day requests", "tok/s", "first byte", "cache hit", "context", "list $/M in / out", "30-day paid", "30-day at list", ""].map((t, i) => h("th", { class: i >= 2 && i <= 9 ? "num" : "" }, t)))), h("tbody", {}, ...rows)), list.length > 400 ? h("p", { class: "muted small" }, `${list.length - 400} more models; narrow the filter.`) : null) : empty("No models match", M.agents ? "Loosen the filter." : "Turn on “include coding agents” or loosen the filter."));
    };
    load();
    const search = h("input", { type: "search", placeholder: "filter models or providers…", value: M.q, class: "usage-q", oninput: (e) => { M.q = e.target.value; draw(); } });
    const cb = (key, label, title) => h("label", { class: "check", title }, (() => { const i = h("input", { type: "checkbox" }); i.checked = !!M[key]; i.onchange = () => { M[key] = i.checked; draw(); }; return i; })(), label);
    return h("div", {},
      intro("models", h("p", {}, "Every model your routes can reach, one group per model and one line per provider that serves it — its variant ids folded in, as the harness's picker shows them. The numbers come from your own traffic in the last 30 days, a model's ids added up; the list prices from each upstream card's Tune → Pricing. Use it to decide where to send a model: the cheapest, the fastest, or the one with the best cache hit rate."), h("ul", { class: "small" }, h("li", {}, "Click a name to ping it: a tiny real request through your routes and rules."), h("li", {}, "Models served by more than one provider sort first."), h("li", {}, "Coding agents advertise hundreds of names and are paid by subscription; they stay hidden unless you tick “include coding agents”."))),
      h("section", { class: "panel" }, h("div", { class: "row", style: "margin:0 0 10px;align-items:center;gap:12px;flex-wrap:wrap" }, h("h2", { style: "margin:0" }, "Model catalogue"), M.at ? h("span", { class: "muted small", title: "The list is cached; opening this page does not re-ask your providers" }, `list from ${memAgo(new Date(M.at).toISOString())}`) : null, h("button", { class: "sm", title: "Ask every upstream for its current model list again. Slow when a provider advertises hundreds of names — the cached list is used until you press this.", onclick: (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = "refreshing…"; load(true).finally(() => { b.disabled = false; b.textContent = "Refresh models"; }); } }, "Refresh models"), h("span", { class: "grow" }), cb("multi", "only models at 2+ providers", "Show only models you can get from more than one place"), cb("agents", "include coding agents", "Cursor, Claude Code, Codex and Qoder CLI names"), search), box));

  // ---- Memory hub: Overview ------------------------------------------------------------------------------------}

}
