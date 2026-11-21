// @ts-check
import { ui } from "../runtime.js";
import { TRAFFIC_VIEWS } from "../nav.js";

export function requests() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester,
    modelCatalog, failoverRows, failoverSentence, flowDiagram, cmpTable,
    section, bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    qs, rx, bare, setStatus, loadAll,
    loadSavedAndGo, loadRequests, loadOps, hashFor,
    startLiveTicker, requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten,
    mergedRules, input, idInput, pingResult, memStatus, memAgo,
    memWhen, memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg,
    memSessionLink, memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel,
    memBackfillControl, memResultsTable, memSummary,
    commandsDoc, memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h,
    $, store, md, mdDoc, mdBlock, esc,
    setHtml, statusPill, phaseOf,
  } = /** @type {any} */ (ui);


    const F = setReqFilter(); // merged against REQ_FILTER_DEFAULTS, so a partial object from any caller is still complete
    const all = state.requests;
    // The tabs are views over the ONE list the client already holds, not separate fetches: switching is instant and
    // can never desync from the live stream. All (requests + operations), System, Agents and Live are on this same
    // strip.
    const TABS = TRAFFIC_VIEWS;
    const SRC = state.schema?.trafficSources || {};
    const PURPOSES = state.schema?.memoryPurposes || {};
    const inTab = (r) => (F.tab === "memory" ? r.source === "memory" : F.tab === "client" ? r.source === "client" : true);
    const passes = (r) => (F.status === "all" || (F.status === "error" ? r.status === "error" : F.status === "ok" ? r.status === "ok" : r.status === "pending")) && (!F.upstream || r.upstream === F.upstream) && (!F.changed || (r.changes?.length || 0) > 0) && (!F.q || `${r.model} ${r.upstreamModel || ""} ${r.error || ""} ${(r.changes || []).join(" ")}`.toLowerCase().includes(F.q));
    const list = all.filter((r) => inTab(r) && (!F.source || r.source === F.source) && (!F.purpose || String(r.memoryFor?.purpose || "") === F.purpose) && passes(r));
    // Operations, for the System and All tabs. The kind chips default to the significant kinds and the firehose ones
    // (searches, engine calls, tool calls, stream milestones) stay recorded but hidden until switched on — the
    // owner's choice: record everything, do not drown the audit trail in it.
    const isOpsTab = F.tab === "system"; const isAllTab = F.tab === "all"; const isAgentsTab = F.tab === "agents"; const isLiveTab = F.tab === "live";
    // Neither the status/upstream/source filters nor the token chips mean anything on a page of operations or agents — those views render their own headings. Leaving inert controls on screen is how the Phase A P1 happened.
    const isRequestView = !isOpsTab && !isAllTab && !isAgentsTab && !isLiveTab;
    const KINDS = state.schema?.opKinds || {};
    const shownKinds = (state.opKinds ||= new Set(Object.keys(KINDS).filter((k) => !KINDS[k]?.noisy)));
    const nq = (F.q || "").trim().toLowerCase();
    const opsList = state.ops.filter((o) => shownKinds.has(o.kind) && (!nq || `${o.title} ${o.kind} ${o.sub || ""} ${Object.values(o.detail || {}).join(" ")}`.toLowerCase().includes(nq)));
    // NOT sliced here: the "Show more" button and its hidden-count compare visRows against F.limit, which a
    // pre-sliced list can never exceed — the button simply never appeared on this tab. Slice at render and export.
    const mixed = isAllTab
      ? [...list.map((r) => ({ type: "request", ts: Date.parse(r.ts), r })), ...opsList.map((o) => ({ type: "op", ts: Date.parse(o.ts), op: o }))].sort((a, b) => b.ts - a.ts)
      : null;
    // The rows THIS tab is showing, whatever kind they are. Export and "Show more" both used to count `list` (requests)
    // even on a page of operations, so the button said "17 hidden" about rows that were not on screen and the download
    // contained the wrong thing. One source of truth for "what am I looking at".
    // The Agents tab holds TWO kinds of row now — turns from the request ring, and durable lifecycle operations from
    // the op log. Export and "Show more" both read visRows, so if it only held the turns the download would be missing
    // every permission decision and process exit the user can see on screen — the exact mismatch this one helper was
    // introduced to stop. Merged and tagged the same way the All tab merges, so the file says what each row is.
    const agentRows = isAgentsTab
      ? [...all.filter((r) => r.acp).map((r) => ({ type: "request", ts: Date.parse(r.ts), r })), ...(state.ops || []).filter((o) => o.kind === "agent").map((o) => ({ type: "op", ts: Date.parse(o.ts), op: o }))].sort((a, b) => b.ts - a.ts)
      : null;
    const visRows = isOpsTab ? opsList : isAllTab ? (mixed || []) : isAgentsTab ? agentRows : isLiveTab ? [] : list;
    // Counts on the tab strip, so you can see which view holds something before clicking into it. Raw counts, not the
    // filtered list: a number that changes with the search box stops meaning "how much is there".
    const TAB_COUNTS = {
      all: all.length + (state.ops || []).length,
      requests: all.length,
      client: all.filter((r) => r.source === "client").length,
      memory: all.filter((r) => r.source === "memory").length,
      // Turns AND lifecycle events: a badge that counted only the turns said "Agents · 3" on a tab showing nine rows,
      // so the six durable events were invisible before you clicked in.
      agents: all.filter((r) => r.acp).length + (state.ops || []).filter((o) => o.kind === "agent").length,
      system: (state.ops || []).length,
      live: all.filter((r) => r.status === "pending").length,
    };
    const kindChips = (isOpsTab || isAllTab) && Object.keys(KINDS).length ? h("div", { class: "seg", style: "margin-bottom:10px" }, ...Object.entries(KINDS).map(([k, m]) => {
      // A kind with no producer yet is dimmed and says so. Showing eleven chips that can never fill would advertise
      // coverage the audit trail does not have — which is worse than admitting the gap.
      const wired = !Array.isArray(state.opWired) || state.opWired.includes(k);
      return h("button", {
        class: `${shownKinds.has(k) ? "active" : ""}${wired ? "" : " unwired"}`,
        title: `${m.hint || ""}${m.noisy ? "\n\nRecorded but hidden by default: it fires several times per request." : ""}${wired ? "" : "\n\nNothing emits this kind yet — the chip is here so the list is complete, and it will fill in when the producer is wired."}`,
        onclick: () => { if (shownKinds.has(k)) shownKinds.delete(k); else shownKinds.add(k); render(); },
      }, `${m.label || k}${state.opCounts?.[k] ? ` · ${state.opCounts[k]}` : wired ? "" : " · –"}`);
    })) : null;
    if (all.some((r) => r.status === "pending")) startLiveTicker();
    const sum = list.reduce((a, r) => { a.n++; if (r.status === "error") a.err++; a.in += (r.tokens?.input || 0) + (r.tokens?.cacheRead || 0); a.out += r.tokens?.output || 0; a.cost += r.cost || 0; if (r.ttftMs != null) { a.ttft.push(r.ttftMs); } return a; }, { n: 0, err: 0, in: 0, out: 0, cost: 0, ttft: [] });
    const p50 = sum.ttft.length ? [...sum.ttft].sort((a, b) => a - b)[Math.floor(sum.ttft.length / 2)] : null;
    const sel = (opts, val, on) => { const s = h("select", {}, ...opts.map(([v, l]) => h("option", { value: v, selected: v === val ? "" : null }, l))); s.onchange = () => { on(s.value); render(); }; return s; };
    const q = h("input", { type: "text", placeholder: "search model, upstream, error text, change…", value: F.q, style: "flex:1 1 140px;min-width:140px;max-width:320px" }); q.oninput = () => { F.q = q.value.trim().toLowerCase(); F.limit = 100; const pos = q.value.length; render(); const el = $("#view input[placeholder^='search model']"); el?.focus(); el?.setSelectionRange(pos, pos); };
    const chip = (label, v, sub) => h("div", { class: "card stat mini-stat" }, h("div", { class: "label" }, label), h("div", { class: "big" }, v), sub ? h("div", { class: "sub" }, sub) : null);
    const exportBtn = h("button", { class: "sm", title: "Download what THIS tab is showing as JSON — operations on System, agent turns and lifecycle events on Agents, the merged feed on All", onclick: () => { const rows = visRows.slice(0, F.limit); if (!rows.length) return toast("Nothing to export on this tab", "err"); const blob = new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `filament-${F.tab}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } }, "Export JSON");
    return h("div", {},
      h("div", { class: "seg", style: "margin-bottom:12px" }, ...TABS.map(([v, label, title]) => h("button", { class: F.tab === v ? "active" : "", title, onclick: () => { F.tab = v; F.source = ""; F.purpose = ""; F.limit = 100; try { history.replaceState(null, "", hashFor()); } catch {} render(); } }, TAB_COUNTS[v] ? `${label} · ${TAB_COUNTS[v]}` : label))),
      // The four stat chips describe model calls, so the ops tabs get chips that describe operations instead — showing
      // "Tokens 0 · Cost $0.0000" on a page of config changes would be noise that reads like a bug.
      isLiveTab || isAgentsTab ? null
        : (isOpsTab || isAllTab)
        ? h("div", { class: "grid4", style: "margin-bottom:14px" },
          chip("Operations", fmt.n(opsList.length), `${fmt.n(state.ops.length)} held · ${shownKinds.size} of ${Object.keys(KINDS).length} kinds switched on`),
          chip("Warnings", fmt.n(state.ops.filter((o) => o.level === "warn").length), "cooldowns, refused jobs, config changes needing a restart"),
          chip("Errors", fmt.n(state.ops.filter((o) => o.level === "error").length), "failed jobs and anything Filament logged at error level"),
          chip(isAllTab ? "Model calls" : "Newest", isAllTab ? fmt.n(list.length) : (state.ops[0] ? fmt.t(state.ops[0].ts) : "–"), isAllTab ? "mixed into the stream below" : (state.ops[0] ? String(state.ops[0].title || "").slice(0, 40) : "nothing recorded yet")))
        : h("div", { class: "grid4", style: "margin-bottom:14px" }, chip("Shown", fmt.n(sum.n), `${fmt.n(sum.err)} errors · of ${fmt.n(all.length)} in memory · ${TABS.find((t) => t[0] === F.tab)?.[1] || "Requests"}`), chip("Tokens", fmt.n(sum.in + sum.out), `${fmt.n(sum.in)} in · ${fmt.n(sum.out)} out`), chip("Cost", fmt.usd(sum.cost), "API models only"), chip("First byte p50", fmt.ms(p50), "time to first token")),
      h("div", { class: "toolbar wrap" },
        // These four filter model calls, so on the System tab — which holds only operations — they are hidden rather
        // than left visible and inert. A control that silently does nothing is how the P1 in this phase's review ended
        // up looking like a working page.
        ...(isRequestView || isAllTab ? [
          sel([["all", "all statuses"], ["ok", "ok"], ["error", "errors"], ["pending", "pending / in flight"]], F.status, (v) => (F.status = v)),
          sel([["", "all upstreams"], ...state.config.upstreams.map((u) => [u.id, upLabel(u)])], F.upstream, (v) => (F.upstream = v)),
          // Whose call it was. The options are only the sources actually present, so this is never a list of dead
          // choices, and the labels come from the schema instead of being retyped here.
          sel([["", "every source"], ...[...new Set(all.map((r) => r.source).filter(Boolean))].map((s) => [s, SRC[s]?.label || s])], F.source, (v) => (F.source = v)),
          F.tab === "memory" || F.source === "memory"
            ? sel([["", "every purpose"], ...[...new Set(all.filter((r) => r.source === "memory").map((r) => r.memoryFor?.purpose).filter(Boolean))].map((p) => [p, PURPOSES[p]?.label || p])], F.purpose, (v) => (F.purpose = v))
            : null,
        ] : []),
        q,
        // "only changed" and "group conversations" are properties of request ROWS; on a page of operations,
        // agents or live work they would be inert. The search box stays, because it filters every kind.
        ...(isRequestView || isAllTab ? [
          h("label", { class: "check" }, (() => { const cb = h("input", { type: "checkbox" }); cb.checked = F.changed; cb.onchange = () => { F.changed = cb.checked; render(); }; return cb; })(), "only changed"),
          h("label", { class: "check", title: "Fold the requests of one chat session into a single row; click it to open" }, (() => { const cb = h("input", { type: "checkbox" }); cb.checked = F.group !== false; cb.onchange = () => { F.group = cb.checked; render(); }; return cb; })(), "group conversations"),
        ] : []),
        h("label", { class: "check", style: "margin-left:auto" }, (() => { const cb = h("input", { type: "checkbox" }); cb.checked = state.live; cb.onchange = () => (state.live = cb.checked); return cb; })(), "live"),
        exportBtn,
        // Saved views (W9 Phase E). A filter set is worth keeping, because "memory calls that errored" and "warnings
        // of the last hour" are queries you want to come back to without rebuilding them. Stored beside the
        // theme in localStorage; nothing is sent to the server, so a view cannot leak what it filtered.
        (() => {
          const KEY = "traffic.views";
          const read = () => { try { return JSON.parse(store.get(KEY) || "{}"); } catch { return {}; } };
          const names = Object.keys(read()).sort();
          const sel = h("select", { title: "Apply a saved filter view" },
            h("option", { value: "" }, names.length ? "saved views…" : "no saved views"),
            ...names.map((n) => h("option", { value: n }, n)));
          sel.onchange = () => { const v = read()[sel.value]; if (!v) return; state.reqFilter = { ...REQ_FILTER_DEFAULTS, ...v }; try { history.replaceState(null, "", hashFor()); } catch {} render(); };
          const save = h("button", { class: "sm", title: "Save the current tab, filters and search as a named view", onclick: () => { const name = (prompt("Name this view", `${F.tab} view`) || "").trim(); if (!name) return; const all = read(); all[name] = { ...F }; store.set(KEY, JSON.stringify(all)); toast(`Saved "${name}"`); render(); } }, "Save view");
          const del = h("button", { class: "sm ghost danger", title: "Delete the view selected in the dropdown", onclick: () => { const all = read(); const n = sel.value; if (!n || !(n in all)) return toast("Pick a saved view to delete first", "err"); delete all[n]; store.set(KEY, JSON.stringify(all)); toast(`Deleted "${n}"`); render(); } }, "✕");
          return h("span", { class: "row", style: "gap:4px;align-items:center" }, sel, save, del);
        })(),
        h("button", { class: "sm", title: "Re-read requests and operations from the server", onclick: () => Promise.all([loadRequests(), loadOps()]).then(render) }, "Refresh")),
      kindChips,
      isLiveTab ? liveView()
        : isAgentsTab ? agentsView(F.limit)
        : isOpsTab ? opsTable(opsList.slice(0, F.limit))
        : isAllTab ? mixedTable((mixed || []).slice(0, F.limit))
          : list.length ? requestsTable(list.slice(0, F.limit), { dividers: true, group: F.group !== false }) : empty(all.length ? "Nothing matches these filters" : "No requests yet", all.length ? "Loosen a filter above." : "Traffic from your agents appears here live."),
      !isLiveTab && visRows.length > F.limit ? h("div", { class: "toolbar", style: "margin-top:10px" }, h("button", { class: "sm", onclick: () => { F.limit += 200; render(); } }, `Show more (${visRows.length - F.limit} hidden)`)) : null);
}
