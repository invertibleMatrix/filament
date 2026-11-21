// @ts-check
import { ui } from "../runtime.js";
import { rollupCosts, listDiffers } from "../lib/cost.js";
import { upstreamWords, projectWords } from "../lib/format.js";
import { kindOf } from "../lib/upstream-kinds.js";

export function usage() {
  const {
    state, render, go, goto, toast, api,
    intro, empty, schemaForm, markDirty, setReqFilter, REQ_FILTER_DEFAULTS,
    HOME_PANES, HUBS, PAGES, copyline, secretLine, upLabel,
    upDisplay, removeUpstream, routeMeaning, routeTester,
    modelCatalog, failoverRows, failoverSentence, flowDiagram, cmpTable,
    section, bridgeModes, BRIDGE_HINT, FAIL_CAUSES, STRATEGIES,
    rx, bare, setStatus, loadAll, loadSavedAndGo,
    loadRequests, loadOps, hashFor, startLiveTicker,
    requestsTable, opsTable, mixedTable, liveView, agentsView,
    openRequest, openRulesDrawer, flatten, mergedRules,
    input, idInput, pingResult, memStatus, memAgo, memWhen,
    memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg, memSessionLink,
    memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel, memBackfillControl,
    memResultsTable, memSummary, commandsDoc,
    memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h, store,
    md, mdDoc, mdBlock, setHtml, statusPill, phaseOf,
  } = /** @type {any} */ (ui);


    const U = (state.usageFilter ||= { mode: "today", day: null, from: null, to: null, q: "", group: "pair" });
    const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = dayStr(new Date());
    const shift = (day, n) => { const [y, m, d] = day.split("-").map(Number); return dayStr(new Date(y, m - 1, d + n)); };
    const nice = (day) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: y === new Date().getFullYear() ? undefined : "numeric" }); };
    const sel = U.mode === "today" ? { from: today, to: today, label: `Today · ${nice(today)}` }
      : U.mode === "yesterday" ? { from: shift(today, -1), to: shift(today, -1), label: `Yesterday · ${nice(shift(today, -1))}` }
      : U.mode === "7d" ? { from: shift(today, -6), to: today, label: "Last 7 days" }
      : U.mode === "30d" ? { from: shift(today, -29), to: today, label: "Last 30 days" }
      : U.mode === "all" ? { from: null, to: null, label: "All time" }
      : U.mode === "month" ? { from: today.slice(0, 8) + "01", to: today, label: new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }) }
      : U.mode === "lastmonth" ? (() => { const d = new Date(); d.setDate(0); const last = dayStr(d); return { from: last.slice(0, 8) + "01", to: last, label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }; })()
      : U.mode === "day" ? { from: U.day, to: U.day, label: U.day === today ? `Today · ${nice(U.day)}` : nice(U.day) }
      : { from: U.from || null, to: U.to || null, label: `${U.from || "start"} → ${U.to || "today"}` };
    const oneDay = sel.from && sel.from === sel.to;
    const qs = new URLSearchParams(); if (sel.from) qs.set("from", sel.from); if (sel.to) qs.set("to", sel.to);
    // ---- controls ----
    const seg = (items, cur, onpick) => h("div", { class: "seg" }, ...items.map(([v, label, title]) => h("button", { class: cur === v ? "active" : "", title: title || null, onclick: () => onpick(v) }, label)));
    const quick = seg([["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["30d", "30 days"], ["month", "This month"], ["lastmonth", "Last month"], ["all", "All time"], ["range", "Custom…"]], U.mode, (v) => { U.mode = v; if (v === "range" && !U.from) { U.from = shift(today, -13); U.to = today; } render(); });
    const anchor = oneDay ? sel.from : sel.to || today;
    const dayNav = h("div", { class: "seg daynav" },
      h("button", { title: "Previous day", onclick: () => { U.mode = "day"; U.day = shift(anchor, -1); render(); } }, "‹"),
      h("input", { type: "date", value: anchor, max: today, onchange: (e) => { if (e.target.value) { U.mode = "day"; U.day = e.target.value; render(); } } }),
      h("button", { title: "Next day", disabled: anchor >= today ? "" : null, onclick: () => { U.mode = "day"; U.day = shift(anchor, 1); render(); } }, "›"));
    const range = U.mode === "range" ? h("div", { class: "seg daynav" }, h("input", { type: "date", value: U.from || "", max: today, onchange: (e) => { U.from = e.target.value || null; render(); } }), h("span", { class: "muted small" }, "to"), h("input", { type: "date", value: U.to || "", max: today, onchange: (e) => { U.to = e.target.value || null; render(); } })) : null;
    const search = h("input", { type: "search", placeholder: "filter models or upstreams…", value: U.q, class: "usage-q", oninput: (e) => { U.q = e.target.value; drawTable(); } });
    const group = seg([["pair", "Model × upstream"], ["model", "Model"], ["upstream", "Upstream"]], U.group, (v) => { U.group = v; drawTable(); });
    const csv = h("button", { title: "Every day × upstream × model in the selection, for Excel or Sheets", onclick: () => { window.location.href = `/api/usage/days.csv?${qs}`; } }, "Download CSV");
    const controls = h("div", { class: "usage-controls" }, quick, dayNav, range, h("span", { class: "grow" }), csv);
    // ---- data ----
    const statsBox = h("div", { class: "usage-stats" }, h("span", { class: "muted small" }, "loading…"));
    const chartBox = h("div", {}, h("span", { class: "muted small" }, "loading…"));
    const byUpBox = h("div", {});
    const lbBox = h("div", {}); // the model leaderboard: your own traffic, ranked
    const whoBox = h("div", {}); // by client / by project: which tool and which folder burned the money
    const tableBox = h("div", {});
    const UP_COLORS = ["#4f46e5", "#0891b2", "#d97706", "#059669", "#db2777", "#7c3aed", "#64748b"];
    const stat = (label, value, sub) => h("div", { class: "card stat" }, h("div", { class: "label" }, label), h("div", { class: "big" }, value), sub ? h("div", { class: "sub" }, sub) : null);
    let total = null;
    // Whose money this period was. The two durable stores stay SPLIT on purpose — that is what keeps "your spend"
    // meaning your spend, and the on-disk history continuous across this change — so the combined figure is added up
    // here for display instead of merging the files. Everything else on this page stays your tools' traffic.
    const splitBox = h("div", { class: "usage-stats" }, h("span", { class: "muted small" }, "loading…"));
    const drawSplit = () => {
      const cli = total || {};
      api(`/memory/usage?${qs}`).then((m) => {
        const mem = m?.total || {}; const c = cli.cost || 0, k = mem.cost || 0;
        splitBox.replaceChildren(
          // "Client traffic", not "your tools": the durable split is memory's own calls versus everything else, so
          // Filament's health pings, its dashboard assistant and clients' housekeeping pings are counted here too.
          // Naming them is honest; calling the card "your tools" would overstate what you sent.
          stat("Client traffic", fmt.usd(c), `${fmt.n(cli.requests || 0)} request(s): your tools, plus health pings, the console's assistant and housekeeping — everything charted below`),
          stat("Memory's own calls", fmt.usd(k), k || mem.requests ? `${fmt.n(mem.requests || 0)} call(s): learning, recall rewrites, compaction summaries and their slices, the engine` : "none in this period"),
          stat("Combined", fmt.usd(c + k), listDiffers(c + k, (cli.listCost || 0) + (mem.listCost || 0)) ? `what this period paid, both sides together · ${fmt.usd((cli.listCost || 0) + (mem.listCost || 0))} at list price` : "what this period actually cost, both sides together"),
          h("div", { class: "card stat" }, h("div", { class: "label" }, "See the calls"), h("div", { class: "sub", style: "margin-top:6px" },
            h("button", { class: "sm", title: "Traffic → Memory: every call Filament made on its own account, with its purpose, tokens and timing", onclick: () => { setReqFilter({ tab: "memory", source: "", purpose: "" }); go("requests"); } }, "Traffic → Memory"))));
      }).catch(() => splitBox.replaceChildren(h("span", { class: "muted small" }, "memory's own calls could not be listed, so every call in this period counts as one of yours")));
    };
    // paid (`cost`), and the same tokens at list price with the part of it plans paid instead (Providers P4)
    const COUNTERS = ["requests", "ok", "errors", "aborted", "input", "cacheRead", "cacheWrite", "output", "thinking", "cost", "costN", "listCost", "listCostN", "planListCost", "tpsSum", "tpsN", "ttftSum", "ttftN", "msSum", "estimated"];
    const derive = (b) => { const cacheable = b.input + b.cacheRead + b.cacheWrite; return { ...b, cacheHitRate: cacheable ? b.cacheRead / cacheable : 0, avgTps: b.tpsN ? Math.round((b.tpsSum / b.tpsN) * 10) / 10 : null, avgTtftMs: b.ttftN ? Math.round(b.ttftSum / b.ttftN) : null, totalTokens: b.input + b.cacheRead + b.cacheWrite + b.output }; };
    const regroup = (rows) => {
      if (U.group === "pair") return rows;
      const m = new Map();
      for (const r of rows) { const k = U.group === "model" ? r.model : r.upstream; const acc = m.get(k) || { ...Object.fromEntries(COUNTERS.map((c) => [c, 0])), model: U.group === "model" ? r.model : "", upstream: U.group === "upstream" ? r.upstream : "", asked: {}, via: new Set() }; for (const c of COUNTERS) acc[c] += r[c] || 0; for (const a of r.asked || []) acc.asked[a.name] = (acc.asked[a.name] || 0) + a.n; acc.via.add(U.group === "model" ? r.upstream : r.model); m.set(k, acc); }
      return [...m.values()].map((r) => ({ ...derive(r), asked: Object.entries(r.asked).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })), via: [...r.via] })).sort((a, b) => b.requests - a.requests || b.totalTokens - a.totalTokens);
    };
    const drawTable = () => {
      if (!total) return;
      const q = U.q.trim().toLowerCase();
      const rows = regroup(total.rows).filter((r) => !q || `${r.model} ${r.upstream} ${(r.via || []).join(" ")} ${(r.asked || []).map((a) => a.name).join(" ")}`.toLowerCase().includes(q));
      if (!total.requests) { tableBox.replaceChildren(empty(`No requests ${U.mode === "all" ? "recorded yet" : "in this period"}`, "Pick another day above, or send something from the Playground.")); return; }
      if (!rows.length) { tableBox.replaceChildren(empty("Nothing matches the filter", "Clear the search box to see every model.")); return; }
      const num = (v, title) => h("td", { class: "num", title: title || null }, v);
      // Paid, at list price, saved by plans (Providers P4). A row with no list count (a model nobody prices) reads
      // "–", never $0.
      const costCells = (r) => {
        const c = rollupCosts(r);
        return [
          num(c.paid, r.costN < r.requests ? `${fmt.n(r.requests - r.costN)} request(s) have no paid figure: agent turns (their tokens are estimates), or a model nobody prices` : "what was paid: $0 on a plan, a provider's own charge when it states one"),
          num(c.list, c.unlisted ? `${fmt.n(c.unlisted)} request(s) without a list figure: no price card` : "the same tokens at the list price"),
          num(c.saved, "the list price of the requests a subscription plan paid $0 for"),
        ];
      };
      const cell = (r) => {
        const asked = (r.asked || []).filter((a) => a.name !== r.model);
        return h("td", {}, h("code", {}, r.model || "–"), r.estimated ? h("span", { class: "muted", title: `${fmt.n(r.estimated)} request(s) had no token counts from the provider; those were estimated from text length` }, " ≈") : null,
          asked.length ? h("div", { class: "muted small" }, "asked as ", ...asked.slice(0, 4).flatMap((a, i) => [i ? ", " : "", h("code", {}, a.name), a.n > 1 ? ` ×${a.n}` : ""]), asked.length > 4 ? ` +${asked.length - 4} more` : "") : null,
          U.group === "model" && r.via?.length ? h("div", { class: "muted small" }, `via ${r.via.join(", ")}`) : null);
      };
      const upCell = (r) => h("td", {}, U.group === "upstream" ? h("b", {}, upstreamWords(r.upstream) || r.upstream) : U.group === "model" ? null : upstreamWords(r.upstream) || r.upstream, U.group === "upstream" && r.via?.length ? h("div", { class: "muted small" }, `${r.via.length} model${r.via.length === 1 ? "" : "s"}: ${r.via.slice(0, 5).join(", ")}${r.via.length > 5 ? "…" : ""}`) : null);
      const tr = (r, cls = "") => h("tr", { class: cls }, U.group === "upstream" ? upCell(r) : cell(r), U.group === "pair" ? upCell(r) : null,
        num(fmt.n(r.requests), `${fmt.n(r.ok)} ok · ${fmt.n(r.errors)} failed · ${fmt.n(r.aborted)} cancelled`), h("td", { class: `num ${r.errors ? "err" : "muted"}` }, fmt.n(r.errors)),
        num(fmt.n(r.input), "input tokens the provider had to read fresh"), num(fmt.n(r.cacheRead), "input tokens served from the provider's prompt cache"), num(fmt.n(r.cacheWrite), "input tokens written into the cache"), num(fmt.n(r.output), r.thinking ? `${fmt.n(r.thinking)} of these were thinking tokens` : "output tokens"),
        num(fmt.pct(r.cacheHitRate), "cache read ÷ all input"), num(r.avgTps != null ? `${r.avgTps}` : "–", "mean output tokens per second after the first byte"), num(r.avgTtftMs != null ? fmt.ms(r.avgTtftMs) : "–", "mean time to the first byte"),
        ...costCells(r));
      const head = h("tr", {}, h("th", {}, U.group === "upstream" ? "Upstream" : "Model"), U.group === "pair" ? h("th", {}, "Upstream") : null, ...["Requests", "Failed", "Input", "Cache read", "Cache write", "Output", "Cache hit", "Avg tok/s", "First byte", "Paid", "At list", "Saved by plans"].map((t) => h("th", { class: "num" }, t)));
      const sum = rows.length > 1 ? tr({ ...derive(rows.reduce((a, r) => { for (const c of COUNTERS) a[c] += r[c] || 0; return a; }, Object.fromEntries(COUNTERS.map((c) => [c, 0])))), model: "Total", upstream: "Total", asked: [], via: [] }, "total") : null;
      tableBox.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small usage-table" }, h("thead", {}, head), h("tbody", {}, ...rows.map((r) => tr(r)), sum))));
    };
    Promise.all([api(`/usage/days?${qs}`), api("/usage/days?limit=60")]).then(([cur, hist]) => {
      total = cur.total;
      const t = total;
      drawSplit();
      statsBox.replaceChildren(
        stat("Requests", fmt.n(t.requests), t.requests ? `${fmt.n(t.ok)} ok · ${fmt.n(t.errors)} failed${t.aborted ? ` · ${fmt.n(t.aborted)} cancelled` : ""}` : "none in this period"),
        stat("Tokens in", fmt.n(t.input + t.cacheRead + t.cacheWrite), `${fmt.n(t.input)} fresh · ${fmt.n(t.cacheRead)} from cache · ${fmt.n(t.cacheWrite)} written to cache`),
        stat("Tokens out", fmt.n(t.output), t.thinking ? `${fmt.n(t.thinking)} thinking` : "generated by the models"),
        stat("Cache hit rate", fmt.pct(t.cacheHitRate), "share of input the provider served from its prompt cache"),
        stat("Average speed", t.avgTps != null ? `${t.avgTps} tok/s` : "–", t.avgTtftMs != null ? `first byte after ${fmt.ms(t.avgTtftMs)} on average` : "measured per request"),
        stat("Paid", t.costN ? fmt.usd(t.cost) : "–", t.costN < t.requests ? `${fmt.n(t.requests - t.costN)} request(s) without a paid figure (agent turns or unknown models)` : "per token at the list price; $0 on a plan"),
        (() => { const c = rollupCosts(t); return stat("At list price", c.list, t.planListCost > 0 ? `${c.saved} saved by plans${c.unlisted ? ` · ${fmt.n(c.unlisted)} request(s) unlisted` : ""}` : c.unlisted ? `${fmt.n(c.unlisted)} request(s) without a list figure` : "the same tokens at the price card"); })());
      // ---- by upstream: one card per provider for the selected period, share bars against the period total ----
      {
        const byUp = new Map();
        for (const r of total.rows || []) { const acc = byUp.get(r.upstream) || { ...Object.fromEntries(COUNTERS.map((c) => [c, 0])), upstream: r.upstream, models: new Set() }; for (const c of COUNTERS) acc[c] += r[c] || 0; acc.models.add(r.model); byUp.set(r.upstream, acc); }
        const ups = [...byUp.values()].map((r) => derive(r)).sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens);
        const maxTok = Math.max(1, ...ups.map((r) => r.totalTokens)); const totCost = ups.reduce((a, r) => a + r.cost, 0);
        const upObj = (id) => state.config.upstreams.find((u) => u.id === id);
        byUpBox.replaceChildren(...[!ups.length ? null : h("section", { class: "panel", style: "margin-bottom:18px" }, h("div", { class: "row", style: "margin:0 0 10px;align-items:baseline" }, h("h2", { style: "margin:0" }, "By upstream"), h("span", { class: "muted small" }, `${ups.length} provider${ups.length === 1 ? "" : "s"} used in this period`)),
          h("div", { class: "up-cards" }, ...ups.map((r, i) => { const u = upObj(r.upstream); const words = upstreamWords(r.upstream); const kind = words ? "Filament's own" : u ? kindOf(u) : "removed"; const color = UP_COLORS[i % UP_COLORS.length];
            return h("div", { class: "card up-card", onclick: () => { U.q = r.upstream; U.group = "pair"; render(); }, title: "Click to filter the table below to this upstream" },
              h("div", { class: "row", style: "margin:0;align-items:center;gap:8px" }, h("i", { class: "swatch", style: `background:${color}` }), h("b", {}, words || u?.name || r.upstream), h("span", { class: "muted small" }, kind), h("span", { class: "grow" }), h("b", { class: "up-cost" }, r.costN ? fmt.usd(r.cost) : "–")),
              h("div", { class: "share" }, h("i", { style: `width:${Math.round((r.totalTokens / maxTok) * 100)}%;background:${color}` })),
              h("div", { class: "muted small up-meta" }, `${fmt.n(r.requests)} request${r.requests === 1 ? "" : "s"} · ${fmt.n(r.totalTokens)} tokens · ${fmt.pct(r.cacheHitRate)} cached · ${r.models.size} model${r.models.size === 1 ? "" : "s"}${r.costN && totCost ? ` · ${Math.round((r.cost / totCost) * 100)}% of spend` : ""}${r.costN < r.requests ? ` · ${fmt.n(r.requests - r.costN)} unpriced` : ""}${r.listCostN && listDiffers(r.cost, r.listCost) ? ` · ${fmt.usd(r.listCost)} at list` : ""}`)); })))].filter((x) => x != null));
      }
      // ---- the leaderboard: models ranked by your own traffic; cost per 1k generated tokens normalizes price ----
      {
        const fold = new Map();
        for (const r of total.rows || []) { const acc = fold.get(r.model) || { ...Object.fromEntries(COUNTERS.map((c) => [c, 0])), model: r.model, via: new Set() }; for (const c of COUNTERS) acc[c] += r[c] || 0; acc.via.add(r.upstream); fold.set(r.model, acc); }
        // The rate is at list price (Providers P4): a plan's $0 says nothing about which model is dear.
        const models = [...fold.values()].map((r) => { const d = derive(r); d.perK = d.listCostN && d.output ? (d.listCost / d.output) * 1000 : null; return d; }).sort((a, b) => b.output - a.output || b.requests - a.requests);
        const num = (v, title) => h("td", { class: "num", title: title || null }, v);
        const priced = models.filter((m) => m.perK != null && m.requests >= 5 && m.listCostN === m.requests);
        const pick = (arr, fn, better) => arr.reduce((best, m) => (best == null || better(fn(m), fn(best)) ? m : best), null);
        const fastest = priced.length ? pick(priced.filter((m) => m.avgTps != null), (m) => m.avgTps, (a, b) => a > b) : null;
        const cheapest = priced.length ? pick(priced, (m) => m.perK, (a, b) => a < b) : null;
        const cached = priced.length ? pick(priced.filter((m) => (m.input + m.cacheRead + m.cacheWrite) > 20000), (m) => m.cacheHitRate, (a, b) => a > b) : null;
        const takeaway = priced.length >= 2 ? [
          fastest && cheapest && fastest.model !== cheapest.model ? `${fastest.model} streamed fastest (${fastest.avgTps} tok/s) while ${cheapest.model} was the cheapest per generated token at list price (${fmt.usd(cheapest.perK)}/1k out).` : fastest ? `${fastest.model} streamed fastest at ${fastest.avgTps} tok/s.` : cheapest ? `${cheapest.model} was the cheapest per generated token at list price (${fmt.usd(cheapest.perK)}/1k out).` : null,
          cached && cached.cacheHitRate > 0.3 ? ` ${cached.model} read ${fmt.pct(cached.cacheHitRate)} of its input from cache — cache reads cost about a tenth of fresh input, so its true cost per useful token is lower than its price card suggests.` : null,
        ].filter(Boolean).join("") : "Fewer than 2 models with at least 5 fully-priced requests in this period — the table below still shows everything, cost columns included when a price is known.";
        const unpriced = models.filter((m) => m.listCostN < m.requests).length;
        lbBox.replaceChildren(...[!models.length ? null : h("section", { class: "panel", style: "margin-bottom:18px" }, h("div", { class: "row", style: "margin:0 0 10px;align-items:baseline" }, h("h2", { style: "margin:0" }, "Model leaderboard"), h("span", { class: "muted small" }, `${models.length} model${models.length === 1 ? "" : "s"} answered in this period · ranked by generated tokens`)),
          h("p", { class: "small", style: "margin:0 0 10px" }, takeaway),
          h("div", { class: "table-wrap" }, h("table", { class: "small usage-table" },
            h("thead", {}, h("tr", {}, h("th", {}, "Model"), ...["Output", "Requests", "Failed", "Avg tok/s", "First byte", "Cache hit", "Paid", "At list", "$ / 1k out"].map((t) => h("th", { class: "num" }, t)))),
            h("tbody", {}, ...models.map((m) => h("tr", { class: "clickable", onclick: () => { U.q = m.model; U.group = "model"; render(); } },
              h("td", {}, h("code", {}, m.model), m.via?.size > 1 ? h("div", { class: "muted small" }, `via ${[...m.via].slice(0, 3).join(", ")}${m.via.size > 3 ? "…" : ""}`) : null),
              num(fmt.n(m.output), m.thinking ? `${fmt.n(m.thinking)} of these were thinking tokens` : "generated tokens"),
              num(fmt.n(m.requests), `${fmt.n(m.ok)} ok · ${fmt.n(m.errors)} failed · ${fmt.n(m.aborted)} cancelled`),
              num(fmt.pct(m.requests ? m.errors / m.requests : 0)),
              num(m.avgTps != null ? `${m.avgTps}` : "–"),
              num(m.avgTtftMs != null ? fmt.ms(m.avgTtftMs) : "–"),
              num(fmt.pct(m.cacheHitRate)),
              num(m.costN ? fmt.usd(m.cost) : "–"),
              num(m.listCostN ? fmt.usd(m.listCost) : "–"),
              num(m.perK != null ? fmt.usd(m.perK) : "–", m.listCostN && m.listCostN < m.requests ? `${fmt.n(m.requests - m.listCostN)} request(s) without a list price: their tokens still count in the denominator, so this rate runs low` : "list price per 1,000 generated tokens")))))),
          unpriced ? h("p", { class: "muted small", style: "margin:8px 0 0" }, `${unpriced} model${unpriced === 1 ? "" : "s"} carried request(s) without a list price (no price card): they appear with latency and tokens, but not in cost comparisons. Model mixes differ by task — filter the table or pick a day before trusting a ranking.`) : h("p", { class: "muted small", style: "margin:8px 0 0" }, "Model mixes differ by task — filter the table or pick a day before trusting a ranking."))].filter((x) => x != null));
      }
      // ---- by client and by project (last 24 h of live records): who spent it, where ----
      {
        const projBox = h("div", {}, h("span", { class: "muted small" }, "loading…"));
        const tbl = (title, note, bodyRows) => h("section", { class: "panel" }, h("h2", { style: "margin:0 0 8px" }, title), h("p", { class: "muted small", style: "margin:0 0 8px" }, note),
          bodyRows.length ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, h("th", {}, title === "By client" ? "client" : "project"), ...["requests", "errors", "tokens out", "paid"].map((t) => h("th", { class: "num", ...(t === "paid" ? { title: "What was paid: $0 for a model on a subscription plan (Providers P4)" } : {}) }, t)))), h("tbody", {}, ...bodyRows))) : h("p", { class: "muted small" }, "Nothing yet in the last 24 hours."));
        const row = (label, v) => h("tr", {}, h("td", {}, label), h("td", { class: "num" }, fmt.n(v.requests)), h("td", { class: "num" }, v.errors ? h("span", { class: "err" }, fmt.n(v.errors)) : "0"), h("td", { class: "num" }, fmt.n(v.output)), h("td", { class: "num" }, v.cost ? fmt.usd(v.cost) : "–"));
        const rows = (o) => Object.entries(o || {}).map(([k, v]) => ({ k, ...v })).sort((a, b) => (b.cost || 0) - (a.cost || 0) || b.requests - a.requests).slice(0, 8);
        api("/usage/summary?hours=24").catch(() => null)
          .then((s24) => {
            if (!s24) return whoBox.replaceChildren();
            projBox.replaceChildren(tbl("By project", "Which working folder the spend happened in: memory names the project on each request it places in a folder. Hover a name for its folder and id.", rows(s24.byProject).map((r) => row(((pw) => h("code", { title: pw.title }, pw.text))(projectWords({ id: r.k, name: r.name, cwd: r.cwd })), r))));
            whoBox.replaceChildren(h("div", { class: "cards two", style: "margin-bottom:18px" },
              tbl("By client", "Which of your tools asked, by the name each gives itself. An agent's own model calls count for the tool that began its turn; a session in the harness is the harness's. Durable per-day history keeps model and upstream only, so this window is the last 24 hours.", rows(s24.byClient).map((r) => row(h("code", {}, r.k), r))),
              projBox));
          });
      }
      // ---- 30-day chart from the durable store, stacked by upstream; click a bar to open that day ----
      const N = 30; const byDay = Object.fromEntries(hist.days.map((d) => [d.day, d]));
      const upTotals = new Map(); for (const d of hist.days) for (const r of d.rows || []) upTotals.set(r.upstream, (upTotals.get(r.upstream) || 0) + (r.totalTokens || 0));
      const topUps = [...upTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, UP_COLORS.length - 1).map(([k]) => k);
      const colorOf = (up) => { const i = topUps.indexOf(up); return UP_COLORS[i >= 0 ? i : UP_COLORS.length - 1]; };
      const days = Array.from({ length: N }, (_, i) => { const day = shift(today, -(N - 1 - i)); const d = byDay[day]; const parts = new Map(); for (const r of d?.rows || []) { const k = topUps.includes(r.upstream) ? r.upstream : "other"; parts.set(k, (parts.get(k) || 0) + (r.totalTokens || 0)); } return { day, tok: d ? d.totalTokens : 0, req: d ? d.requests : 0, err: d ? d.errors : 0, cost: d ? d.cost : 0, parts }; });
      const W = 900, H = 150, bw = W / N; const maxT = Math.max(1, ...days.map((d) => d.tok));
      const inSel = (day) => (!sel.from || day >= sel.from) && (!sel.to || day <= sel.to);
      const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      const bars = days.map((d, i) => {
        const x = i * bw + bw * 0.14, w = bw * 0.72; const total = d.tok || 0; let yTop = H - 18; const segs = [];
        const order = [...topUps, "other"].filter((k) => d.parts.get(k)); for (const k of order) { const hh = (d.parts.get(k) / maxT) * (H - 34); yTop -= hh; segs.push(`<rect class="bar day ${inSel(d.day) ? "sel" : "dim"}" data-day="${d.day}" x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(hh, 0.5).toFixed(1)}" fill="${colorOf(k === "other" ? "" : k)}"><title>${esc(d.day)} · ${esc(k)}: ${d.parts.get(k).toLocaleString()} tokens</title></rect>`); }
        if (!segs.length && d.req) segs.push(`<rect class="bar day ${inSel(d.day) ? "sel" : "dim"}" data-day="${d.day}" x="${x.toFixed(1)}" y="${H - 20}" width="${w.toFixed(1)}" height="2" fill="var(--text-3)"></rect>`);
        const lbl = i % 5 === N % 5 || i === N - 1 ? `<text class="lbl" x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${d.day.slice(5).replace("-", "/")}</text>` : "";
        return `<g><title>${esc(d.day)}: ${d.req.toLocaleString()} requests · ${total.toLocaleString()} tokens${d.cost ? ` · $${d.cost.toFixed(4)}` : ""}${d.err ? ` · ${d.err} failed` : ""}</title>${segs.join("")}</g>${lbl}`;
      }).join("");
      const svg = h("div", { class: "spark-wrap", html: `<svg class="spark days stacked" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>` });
      svg.onclick = (e) => { const day = e.target.closest("[data-day]")?.dataset.day; if (day) { U.mode = "day"; U.day = day; render(); } };
      const monthTok = days.reduce((a, d) => a + d.tok, 0), monthReq = days.reduce((a, d) => a + d.req, 0);
      chartBox.replaceChildren(svg, h("div", { class: "spark-legend" }, ...topUps.map((k) => h("span", {}, h("i", { style: `background:${colorOf(k)}` }), upstreamWords(k) || state.config.upstreams.find((u) => u.id === k)?.name || k)), ...(upTotals.size > topUps.length ? [h("span", {}, h("i", { style: `background:${UP_COLORS[UP_COLORS.length - 1]}` }), "other")] : []), h("span", { class: "grow" }), h("span", {}, `${fmt.n(monthReq)} requests · ${fmt.n(monthTok)} tokens in the last 30 days · dimmed bars are outside the selected period`)));
      // ---- hour strip for a single day ----
      if (oneDay && t.requests) { const hrs = t.hours || []; const mx = Math.max(1, ...hrs); chartBox.append(h("div", { class: "hours-wrap" }, h("div", { class: "muted small" }, "By hour"), h("div", { class: "hours" }, ...hrs.map((n, i) => h("i", { style: `height:${Math.max(2, (n / mx) * 100)}%`, title: `${String(i).padStart(2, "0")}:00 – ${n} request${n === 1 ? "" : "s"}` }))), h("div", { class: "hours-lbl" }, ...hrs.map((_, i) => h("span", {}, i % 6 === 0 ? `${i}h` : ""))))); }
      drawTable();
    }).catch((e) => { statsBox.replaceChildren(h("span", { class: "err small" }, e.message)); chartBox.replaceChildren(); tableBox.replaceChildren(); });
    return h("div", {},
      controls,
      h("div", { class: "usage-title" }, h("h2", {}, sel.label), oneDay ? h("span", { class: "muted small" }, "one day, this computer's clock") : null),
      statsBox,
      splitBox,
      whoBox,
      byUpBox,
      lbBox,
      h("section", { class: "card", style: "margin-bottom:18px" }, h("h3", {}, "Last 30 days"), h("p", { class: "muted small", style: "margin:0 0 8px" }, "Tokens per day, stacked by upstream. Click a bar to open that day."), chartBox),
      h("section", { class: "panel" }, h("div", { class: "row", style: "margin:0 0 10px; align-items:center" }, h("h2", { style: "margin:0" }, "Per model"), h("span", { class: "grow" }), group, search), tableBox,
        h("details", { class: "subform", style: "margin-top:12px" }, h("summary", {}, "How these numbers are counted"), h("ul", { class: "small" },
          h("li", {}, h("b", {}, "Tokens"), " come from each reply's own usage figures. Agent turns (Cursor, Claude Code, …) report exact numbers only when the agent does; rows marked ≈ include requests whose tokens were estimated from text length."),
          h("li", {}, h("b", {}, "Cache hit rate"), " = tokens read from the provider's prompt cache ÷ all input tokens (fresh + cache read + cache write). Higher means cheaper and faster turns."),
          h("li", {}, h("b", {}, "Average speed"), " is the mean of each request's output tokens per second, measured after the first byte arrived; ", h("b", {}, "first byte"), " is the mean wait before the reply started."),
          h("li", {}, h("b", {}, "Cost"), " uses each upstream's own list prices (Destinations → Upstreams → a model's tune → Pricing), falling back to Filament's built-in API rates; when a provider states what it charged (xAI does), that exact figure is used. Agent turns billed through a subscription, and models with no price anywhere, show no cost."),
          h("li", {}, h("b", {}, "Model"), " is the name that was actually served (after routing); \"asked as\" lists the names your client used, effort suffixes included."),
          h("li", {}, "Days follow this computer's clock. History is kept for 400 days in ", h("code", {}, "daily-usage.json"), " next to the config, independent of the request log's rotation (50 MB per file, the last five rotated files kept).")))));
}
