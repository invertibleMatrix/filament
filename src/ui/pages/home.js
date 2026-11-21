// @ts-check
import { ui } from "../runtime.js";
import { listDiffers } from "../lib/cost.js";
import { projectWords, serverBase, sessionWords } from "../lib/format.js";
import { supportsRows } from "../lib/agent-profile.js";
import { isAgentUp } from "../lib/upstream-kinds.js";
import { COVERED, cap, checkWords, extraWords, fullestOf, maskEmail, notYetWords, paceWords, percentWords, reachedWords, readsAs, resetWords, summaryWords, toneOf, whenWords, windowName } from "../lib/accounts.js";

/** The agent upstreams whose account email is shown in full on their card: masked until clicked, while the page lives. */
const shownEmails = new Set();

/**
 * A provider held as one that cannot serve this account (HarnessV3-TaskGraph-v2 TG2-D54), in its health pill's words:
 * "can't serve · allowance used up · 14 min", its title the provider's own words and what the hold does.
 * @param {{ kind: string, said?: string, leftMs?: number | null }} wall
 * @returns {{ text: string, title: string }}
 */
export function wallPill(wall) {
  const out = wall.kind === "out";
  const left = out && wall.leftMs != null ? ` · ${Math.max(1, Math.ceil(wall.leftMs / 60_000))} min` : "";
  const holds = out
    ? "Sub-agents skip it until then, or until a call there succeeds."
    : "Sub-agents skip it until you fix it in Settings, or a call there succeeds.";
  return { text: `can't serve · ${out ? "allowance used up" : "refuses the account"}${left}`, title: `${wall.said ? `${wall.said}\n` : ""}${holds} Reset lets it be tried again now.` };
}

export function overview() {
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
    setHtml, statusPill, phaseOf, liveRow, liveTree, getStarted, startFacts, openRawMessages,
  } = /** @type {any} */ (ui);


    const c = state.config, s = state.summary || {};
    const pane = HOME_PANES.some(([id]) => id === state.homePane) ? state.homePane : "status";
    const base = serverBase(c.server);
    const stat =(label, value, sub) => h("div", { class: "card stat" }, h("div", { class: "label" }, label), h("div", { class: "big" }, value), sub ? h("div", { class: "sub" }, sub) : null);
    const byModel = Object.entries(s.byModel || {}).sort((a, b) => b[1].cost - a[1].cost);
    const key = state.keys?.[0];
    const errRate = s.requests ? s.errors / s.requests : 0;
    // ---- live panel: in-flight requests with tokens/second, refreshed from the event stream ----
    const liveBox = h("div", {});
    const drawLive = (live) => {
      const rows = liveTree(live?.active); // one row per turn, its model call folded in, its sub-agents beneath (R6)
      liveBox.replaceChildren(rows.length ? h("div", {}, ...rows.map(({ r, depth, call }) => liveRow(r, { depth, call }))) : h("p", { class: "muted small", style: "margin:0" }, "Nothing in flight. A request shows here the moment it arrives: pending until the first byte of its reply, then in flight with its speed over the last second."));
    };
    if (pane === "status") { api("/live").then((l) => { drawLive(l); if (l.active?.length) startLiveTicker(); }).catch(() => {}); state._liveDraw = drawLive; } else state._liveDraw = null;
    // ---- last hour timeline as an inline SVG: bars = requests (red part = errors), line = mean first-byte latency ----
    const sparkBox = h("div", { class: "spark-wrap" }, h("span", { class: "muted small" }, "loading…"));
    if (pane === "health") api("/usage/timeline?minutes=60").then(({ buckets }) => {
      const W = 720, H = 72, n = buckets.length, bw = W / n; const maxR = Math.max(1, ...buckets.map((b) => b.requests)); const maxT = Math.max(1, ...buckets.map((b) => b.ttftMs || 0));
      const bars = buckets.map((b, i) => { const hgt = (b.requests / maxR) * (H - 10); const eh = b.requests ? (b.errors / b.requests) * hgt : 0; return `<rect class="bar" x="${(i * bw).toFixed(1)}" y="${(H - hgt).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${hgt.toFixed(1)}"><title>${new Date(b.t).toLocaleTimeString()}: ${b.requests} requests, ${b.errors} errors, ${b.output} output tokens</title></rect>${eh ? `<rect class="bar err" x="${(i * bw).toFixed(1)}" y="${(H - eh).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${eh.toFixed(1)}"></rect>` : ""}`; }).join("");
      const pts = buckets.map((b, i) => (b.ttftMs == null ? null : `${(i * bw + bw / 2).toFixed(1)},${(H - 4 - (b.ttftMs / maxT) * (H - 14)).toFixed(1)}`)).filter(Boolean);
      const line = pts.length > 1 ? `<polyline class="line" points="${pts.join(" ")}" />` : "";
      const total = buckets.reduce((a, b) => a + b.requests, 0), outTok = buckets.reduce((a, b) => a + b.output, 0);
      sparkBox.replaceChildren(h("div", { html: `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="axis" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>${bars}${line}</svg>` }), h("div", { class: "spark-legend" }, h("span", {}, h("i", { style: "background:var(--accent)" }), `requests per minute (${total} in the last hour)`), h("span", {}, h("i", { style: "background:var(--err)" }), "errors"), h("span", {}, h("i", { style: "background:var(--warn)" }), `mean first-byte latency (peak ${fmt.ms(maxT)})`), h("span", { class: "grow" }), h("span", {}, `${fmt.n(outTok)} output tokens`)));
    }).catch((e) => sparkBox.replaceChildren(h("span", { class: "err small" }, e.message)));
    // ---- per-upstream health ----
    const healthBox = h("div", {}, h("span", { class: "muted small" }, "loading…"));
    if (pane === "health") api("/usage/upstreams?hours=24").then(({ upstreams, health = {} }) => {
      const rows = c.upstreams.map((u) => ({ u, st: upstreams[u.id], hb: health[u.id] }));
      const stateCell = (u, st, hb) => {
        if (u.enabled === false) return h("span", { class: "pill" }, "disabled");
        // A provider that said it cannot serve this account (HarnessV3-TaskGraph-v2 TG2-D54), held until when, with Reset.
        if (hb?.wall) {
          const pill = wallPill(hb.wall);
          return h("span", { class: "pill err", title: pill.title }, pill.text, h("button", { class: "sm ghost", style: "margin-left:6px;padding:0 6px", title: "Let it be tried again now", onclick: (e) => { e.stopPropagation(); api(`/health/${encodeURIComponent(u.id)}/reset`, { method: "POST" }).then(() => render()); } }, "reset"));
        }
        if (hb?.coolingDown) return h("span", { class: "pill warn", title: `after ${hb.failures} failure(s): ${hb.lastError?.message || ""}` }, `cooling down · ${Math.ceil(hb.cooldownLeftMs / 1000)} s`, h("button", { class: "sm ghost", style: "margin-left:6px;padding:0 6px", title: "Clear the cooldown and any learned concurrency cap", onclick: (e) => { e.stopPropagation(); api(`/health/${encodeURIComponent(u.id)}/reset`, { method: "POST" }).then(() => render()); } }, "reset"));
        if (hb?.quotaExceeded) return h("span", { class: "pill err" }, "quota exhausted");
        if (hb?.ceilings?.length) return h("span", { class: "pill warn", title: `Learned from a 429 about this account's rate on that model (one that says the provider is overloaded teaches nothing). Extra requests of it wait rather than firing. ${hb.ceilings.map((c) => `${c.model} ${c.probing ? "tries one more" : c.times ? "tries one more" : "lifts"} in ${Math.max(1, Math.ceil((c.liftsInMs || 0) / 60000))} min${c.times ? ` (refused at the same number ${c.times} times in a row)` : ""}`).join(", ")}: ten minutes after its last 429, longer each time it is refused at the same number again, then one more at a time; Reset forgets now.` }, hb.ceilings.map((c) => `${c.model} capped at ${c.cap}`).join(" · ") + " concurrent", h("button", { class: "sm ghost", style: "margin-left:6px;padding:0 6px", title: "Forget the learned concurrency cap", onclick: (e) => { e.stopPropagation(); api(`/health/${encodeURIComponent(u.id)}/reset`, { method: "POST" }).then(() => render()); } }, "reset"));
        if (hb?.rateLimitedSoon) return h("span", { class: "pill warn", title: JSON.stringify(hb.rateLimit) }, "rate limit nearly reached");
        if (!st) return h("span", { class: "pill" }, "no traffic");
        const ok = 1 - st.errorRate; return h("span", { class: `pill ${ok >= 0.98 ? "ok" : ok >= 0.9 ? "warn" : "err"}` }, ok >= 0.98 ? "healthy" : ok >= 0.9 ? "degraded" : "failing");
      };
      const disabledN = rows.filter(({ u }) => u.enabled === false).length; let showOff = false;
      const table = () => h("div", {}, h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["upstream", "state", "requests · 24h", "success", "first byte p50 / p95", "tok/s p50", "output tokens", "cost", "rate limit left", "last error"].map((x) => h("th", {}, x)))), h("tbody", {}, ...rows.filter(({ u }) => showOff || u.enabled !== false).map(({ u, st, hb }) => { const ok = st ? 1 - st.errorRate : 0; const rl = hb?.rateLimit; return h("tr", {}, h("td", {}, h("b", {}, u.name || u.id), h("div", { class: "muted small" }, upLabel(u).split(" · ")[1])), h("td", {}, stateCell(u, st, hb)), h("td", { class: "num" }, st ? fmt.n(st.requests) : "–"), h("td", {}, st ? h("div", { class: "row", style: "margin:0;gap:8px;align-items:center" }, h("div", { class: "health-bar" }, h("i", { class: ok >= 0.98 ? "" : ok >= 0.9 ? "warn" : "bad", style: `width:${Math.round(ok * 100)}%` })), h("span", { class: "small" }, fmt.pct(ok))) : "–"), h("td", {}, st ? `${fmt.ms(st.ttftP50)} / ${fmt.ms(st.ttftP95)}` : "–"), h("td", { class: "num" }, st?.tpsP50 != null ? st.tpsP50 : "–"), h("td", { class: "num" }, st ? fmt.n(st.output) : "–"), h("td", { class: "num" }, st ? (isAgentUp(u) ? "agent" : fmt.usd(st.cost)) : "–"), h("td", { class: "small" }, rl ? `${rl.requestsRemaining != null ? fmt.n(rl.requestsRemaining) + (rl.requestsLimit ? "/" + fmt.n(rl.requestsLimit) : "") + " req" : ""}${rl.tokensRemaining != null ? (rl.requestsRemaining != null ? " · " : "") + fmt.n(rl.tokensRemaining) + " tok" : ""}` : h("span", { class: "muted" }, "–")), h("td", { class: "small muted", title: st?.lastError?.message || "" }, st?.lastError ? `${fmt.t(st.lastError.at)} · ${st.lastError.message.slice(0, 60)}` : "–")); })))),
        disabledN ? h("p", { class: "muted small", style: "margin:8px 0 0" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); showOff = !showOff; healthBox.replaceChildren(table()); } }, showOff ? "Hide disabled upstreams" : `Show ${disabledN} disabled upstream${disabledN === 1 ? "" : "s"}`)) : null);
      healthBox.replaceChildren(table());
    }).catch((e) => healthBox.replaceChildren(h("span", { class: "err small" }, e.message)));
    // ---- subscriptions & quotas: one card per upstream saying what pays for it and how much is left ----
    const subsBox = h("div", { class: "subs" }, h("span", { class: "muted small" }, "loading…"));
    const qmap = {}; let drawSubs = () => {};
    if (pane === "health") {
    for (const u of c.upstreams.filter((x) => x.type === "qoder")) api(`/qoder/${encodeURIComponent(u.id)}/status?quota=1`).then((q) => { qmap[u.id] = q; drawSubs(); }).catch(() => { qmap[u.id] = { loggedIn: false }; drawSubs(); });
    // The coding agents' accounts are read with the rest (HarnessV3-ACP AC3-6): each card is drawn once, with what its
    // agent said; the app's follow keeps them fresh after.
    Promise.all([api("/usage/upstreams?hours=24"), api("/acp/agents").catch(() => ({ agents: [] })), api("/agent-accounts").catch(() => null)]).then(([stats, ag, said]) => { if (said?.agents) state.accounts = said.agents; drawSubs = () => {
      const health = stats.health || {}; const agents = Object.fromEntries((ag.agents || []).map((a) => [a.id, a]));
      const fallbackOf = (id) => { const r = c.routes.find((x) => x.enabled !== false && x.upstream === id); return r?.fallbacks?.[0]?.upstream || null; };
      const ago = (iso) => { const d = Date.now() - new Date(iso).getTime(); return d < 60000 ? "just now" : d < 3600000 ? `${Math.round(d / 60000)} min ago` : `${(d / 3600000).toFixed(1)} h ago`; };
      const bar = (used, total) => { const pct = total ? Math.min(1, used / total) : 0; return h("div", { class: "quota-bar", title: `${fmt.n(used)} of ${fmt.n(total)} used` }, h("i", { class: pct >= 0.95 ? "bad" : pct >= 0.75 ? "warn" : "", style: `width:${Math.round(pct * 100)}%` })); };
      const offList = c.upstreams.filter((u) => u.enabled === false);
      const cards = c.upstreams.filter((u) => u.enabled !== false).map((u) => {
        const st = stats.upstreams?.[u.id]; const hb = health[u.id]; const off = false; const lines = []; let kind, tag, pill;
        /** @type {[string, any] | null} a coding agent's word on its account's age, and its Check now */
        let foot = null;
        // A coding agent (HarnessV3-ACP AC3-6): whose plan pays for it as the agent said it, each window of that plan
        // with its share, its bar and its reset, its extra usage and credits, and Check now. An ACP agent and Codex
        // bring their own login; the Cursor SDK runs on its key.
        if (isAgentUp(u)) {
          const a = agents[u.id]; const keyless = !!state.schema.upstreamTypes[u.type]?.keyless; const t = Date.now();
          const row = state.accounts.find((x) => x.upstream === u.id); const acc = row?.account || null;
          // What the agent said wins; before it said anything, its CLI's own word on the login.
          const signedOut = acc?.identity ? acc.signedOut : a?.loggedIn === false;
          const id = acc?.identity && !signedOut ? acc.identity : null; const w = fullestOf(acc);
          kind = keyless ? "coding agent · its own login" : "coding agent · its API key"; tag = "agent";
          pill = a && !a.installed ? h("span", { class: "pill err" }, "not installed") : signedOut ? h("span", { class: "pill err" }, "not signed in") : !keyless && !u.apiKey ? h("span", { class: "pill warn" }, "key missing") : acc?.spent ? h("span", { class: "pill err" }, "plan spent") : acc?.extraCovers ? h("span", { class: "pill warn" }, "on extra usage") : w?.state === "warning" ? h("span", { class: "pill warn" }, "near its limit") : h("span", { class: "pill ok" }, "ready");
          const shown = shownEmails.has(u.id);
          const email = id?.email ? h("a", { href: "#", class: "golink", title: shown ? "Hide the email" : "Show the email", onclick: (e) => { e.preventDefault(); if (shown) shownEmails.delete(u.id); else shownEmails.add(u.id); drawSubs(); } }, shown ? id.email : maskEmail(id.email)) : null;
          lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Paid by"), id ? h("b", {}, id.label) : h("span", {}, signedOut ? "nobody is signed in" : a?.account || `your ${(u.name || u.id).replace(" (agent via ACP)", "")} subscription`), id?.organization ? h("span", {}, id.organization) : null, email));
          // An agent with a sign-in of its own signs in on the harness's Settings (HarnessV3-ACP AC3-7): the card
          // points there; one whose sign-in is only its CLI's keeps the console's Log in, or the CLI's line.
          if (signedOut) lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "To fix"), row?.ways.length ? h("span", {}, "sign in under the harness's ", h("a", { href: "/ui/harness.html#/settings/agents" }, "Settings › Coding agents")) : a?.login ? h("span", {}, "press Log in next to it on the ", goto("upstreams", "Upstreams page"), ", then Check now") : h("span", {}, row?.login ? `run ${row.login} in a terminal, then Check now` : "sign in with the agent's own command, then Check now")));
          else if (row?.says === false) lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Plan limits"), h("span", {}, "kept by the agent itself: it doesn't say its account or its plan's windows")));
          else if (!id) lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Plan limits"), h("span", {}, row ? summaryWords(row, t) : "not read yet")));
          else if (!acc?.windows.length) lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Plan limits"), h("span", {}, acc?.noWindows || (row ? notYetWords(row) : ""))));
          // Each window: its share and its reset in words, then its bar — red once spent, amber from four-fifths used
          // and where extra usage covers a spent one (`readsAs`).
          for (const pw of id ? acc?.windows || [] : []) {
            const known = pw.state === "spent" || (pw.state !== "reset" && pw.usedPercent != null);
            lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, cap(windowName(pw))), h("b", {}, pw.state === "reset" ? "reset" : pw.state === "spent" && pw.usedPercent == null ? "spent" : percentWords(pw)), h("span", {}, pw.state === "reset" ? "its new period shows once the agent reports it" : [resetWords(pw.resetsAt, t), paceWords(pw, t)].filter(Boolean).join(" · "))));
            if (known) lines.push(h("div", { class: "quota-bar", title: `${cap(windowName(pw))}: ${pw.state === "spent" ? `spent${readsAs(acc, pw) === "covered" ? `, ${COVERED}` : ""}` : `${percentWords(pw)} used`}` }, h("i", { class: toneOf(readsAs(acc, pw)) === "error" ? "bad" : toneOf(readsAs(acc, pw)), style: `width:${pw.state === "spent" ? 100 : Math.round(Math.min(100, Math.max(0, Number(pw.usedPercent))))}%` })));
          }
          if (id && acc?.extra) { const [value, sub] = extraWords(acc.extra, t); lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Extra usage"), h("b", {}, value), sub ? h("span", {}, sub) : null)); }
          if (id && acc?.credits) lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Credits"), h("b", {}, acc.credits.unlimited ? "unlimited" : acc.credits.has ? acc.credits.balance || "some" : "none")));
          if (id && acc?.resetCredits) lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Reset credits"), h("b", {}, String(acc.resetCredits.available)), acc.resetCredits.nextExpiresAt != null ? h("span", {}, `the next one expires ${whenWords(acc.resetCredits.nextExpiresAt, t)}`) : null));
          if (id && acc?.spent && !acc.windows.some((x) => x.state === "spent")) lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Stopped"), h("span", {}, reachedWords(acc.reached) || "Codex says the plan has reached its limit")));
          // Check now asks the agent afresh; its answer is drawn at once, the others' with the next read, and what it found
          // is said — the plan as it was, or why none was read.
          const check = row ? h("button", { class: "sm ghost", type: "button", title: checkWords(row), onclick: async () => {
            check.disabled = true; check.textContent = "Checking…";
            const keep = (/** @type {any} */ r) => { if (r) state.accounts = state.accounts.some((x) => x.upstream === r.upstream) ? state.accounts.map((x) => (x.upstream === r.upstream ? r : x)) : [...state.accounts, r]; };
            try { const r = await api(`/agent-accounts/${encodeURIComponent(u.id)}/check`, { method: "POST" }); keep(r.agent); if (r.checked?.said) toast(r.checked.said); } catch (/** @type {any} */ e) { keep(e.body?.agent); toast(`Couldn't check the account: ${e.message}`, "err"); }
            drawSubs();
          } }, "Check now") : null;
          foot = [acc?.at ? `updated ${ago(acc.at)}` : row ? "not heard from yet" : "", check];
        } else if (u.type === "qoder") {
          const q = qmap[u.id]; kind = "account login"; tag = "login";
          pill = off ? h("span", { class: "pill" }, "disabled") : !q ? h("span", { class: "pill" }, "checking…") : !q.loggedIn ? h("span", { class: "pill err" }, "not logged in") : q.expired ? h("span", { class: "pill err" }, "login expired") : q.quota?.exceeded ? h("span", { class: "pill err" }, "credits used up") : h("span", { class: "pill ok" }, "logged in");
          if (q?.email) lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Account"), h("b", {}, q.email)));
          if (q?.quota?.user) { const qu = q.quota.user; lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Credits"), h("b", {}, `${fmt.n(qu.remaining)} left`), h("span", {}, `of ${fmt.n(qu.total)}${q.quota.resetsAt ? ` · resets ${new Date(q.quota.resetsAt).toLocaleDateString()}` : ""}`)), bar(qu.used, qu.total)); }
          if (q?.expiresAt) lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Login valid until"), h("span", {}, new Date(q.expiresAt).toLocaleDateString())));
        } else {
          kind = u.apiKey ? "API key · pay per token" : "no key"; tag = "api key";
          pill = off ? h("span", { class: "pill" }, "disabled") : !u.apiKey ? h("span", { class: "pill warn" }, "key missing") : hb?.coolingDown ? h("span", { class: "pill warn" }, "cooling down") : hb?.rateLimitedSoon ? h("span", { class: "pill warn" }, "rate limit near") : h("span", { class: "pill ok" }, "ready");
          lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Spent · 24h"), h("b", {}, fmt.usd(st?.cost || 0)), h("span", {}, st ? `${fmt.n(st.requests)} requests` : "no traffic yet")));
          const rl = hb?.rateLimit; if (rl && (rl.requestsRemaining != null || rl.tokensRemaining != null)) { lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Rate limit left"), h("b", {}, [rl.requestsRemaining != null ? `${fmt.n(rl.requestsRemaining)} req` : "", rl.tokensRemaining != null ? `${fmt.n(rl.tokensRemaining)} tok` : ""].filter(Boolean).join(" · ")), rl.resetAt ? h("span", {}, `resets ${new Date(rl.resetAt).toLocaleTimeString()}`) : null)); if (rl.tokensLimit && rl.tokensRemaining != null) lines.push(bar(rl.tokensLimit - rl.tokensRemaining, rl.tokensLimit)); }
          else lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "Rate limit"), h("span", {}, "shown after the first reply that reports it")));
        }
        const fb = fallbackOf(u.id);
        lines.push(h("div", { class: "sub-line" }, h("span", { class: "k" }, "If it fails or runs out"), fb ? h("span", {}, "requests move to ", h("b", {}, fb)) : h("span", {}, "requests fail; add a fallback on the ", goto("routes", "Routes page"))));
        return h("div", { class: `sub-card ${off ? "off" : ""}` }, h("div", { class: "sub-head" }, h("b", {}, u.name || u.id), h("span", { class: "kind-tag" }, tag), pill), h("div", { class: "muted small" }, kind), ...lines, h("div", { class: "sub-foot" }, h("span", { class: "muted grow" }, [foot?.[0], st?.lastAt ? `last used ${ago(st.lastAt)}` : ""].filter(Boolean).join(" · ")), foot?.[1] || null, goto("upstreams", "Manage")));
      });
      subsBox.replaceChildren(...(cards.length ? cards : [empty("No upstreams enabled", "Connect one from the provider catalogue (Destinations → + Add), or enable one you already have.")]));
      if (offList.length) subsBox.append(h("div", { class: "sub-card off wide-note" }, h("div", { class: "sub-line" }, h("b", {}, `${offList.length} disabled`), h("span", {}, offList.map((u) => (u.name || u.id).replace(" (agent via ACP)", "")).join(", ")), h("span", { class: "grow" }), goto("upstreams", "Enable"))));
    }; drawSubs(); }).catch((e) => subsBox.replaceChildren(h("span", { class: "err small" }, e.message)));
    }
    // ---- novice-first hero: is everything working, and what should I type into my agent? ----
    const enabledUps = c.upstreams.filter((u) => u.enabled !== false);
    const agents = enabledUps.filter(isAgentUp);
    const routesOn = c.routes.filter((r) => r.enabled !== false).length;
    const lastReq = state.requests[0];
    // Get started (HarnessV3-Launch LD-D2, LD-D3): the server says whether a model can answer. Until one can, the steps
    // take the hero's place; after, they fold to one line above it, open or folded as this browser last left them.
    // Facts not read yet (the server did not answer) leave today's hero: "not set up" is said only when it is known.
    const facts = startFacts();
    const setUp = !facts || facts.connected.ok;
    const gsOpts = { base, key };
    const getStartedAbove = !facts || !setUp ? null : store.get("home.getStarted") === "open"
      ? h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Get started"), h("button", { type: "button", class: "ghost sm", title: "Fold Get started to one line", onclick: () => { store.set("home.getStarted", "folded"); render(); } }, "Fold")), getStarted.steps(facts, gsOpts))
      : getStarted.line(facts);
    // today's totals come from the durable per-day store, the same numbers the Usage page shows
    const todayBox = h("div", { class: "mini-grid" }, h("span", { class: "muted small" }, "loading…"));
    const monthStart = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })();
    if (pane === "status") Promise.all([api("/usage/days?limit=1"), api(`/usage/days?from=${monthStart}`)]).then(([{ today, days }, month]) => {
      const t = days.find((d) => d.day === today); const m = month.total || {};
      const mini = (label, value, sub, cls = "") => h("div", { class: `mini ${cls}` }, h("span", { class: "label" }, label), h("b", {}, value), sub ? h("span", { class: "muted small" }, sub) : null);
      const monthMini = mini(new Date().toLocaleDateString(undefined, { month: "long" }) + " so far", m.costN ? fmt.usd(m.cost) : "–", `${fmt.n(m.requests || 0)} request${m.requests === 1 ? "" : "s"} · ${fmt.n(m.totalTokens || 0)} tokens${m.costN < m.requests ? ` · ${fmt.n(m.requests - m.costN)} unpriced` : ""}`, "wide");
      if (!t) { todayBox.replaceChildren(h("div", { class: "muted small wide" }, "No requests yet today."), monthMini, h("div", { class: "mini-foot" }, goto("usage", "Usage by day and month →"))); return; }
      const top = t.rows[0];
      todayBox.replaceChildren(
        mini("Requests", fmt.n(t.requests), t.errors ? `${fmt.n(t.errors)} failed` : "all succeeded"),
        mini("Tokens", fmt.n(t.totalTokens), `${fmt.n(t.input + t.cacheRead + t.cacheWrite)} in · ${fmt.n(t.output)} out`),
        mini("Cache hits", fmt.pct(t.cacheHitRate), t.avgTps ? `${t.avgTps} tok/s avg` : null),
        mini("Paid", t.costN ? fmt.usd(t.cost) : "–", [t.listCostN && listDiffers(t.cost, t.listCost) ? `${fmt.usd(t.listCost)} at list price` : "", t.costN < t.requests ? `${fmt.n(t.requests - t.costN)} agent turn${t.requests - t.costN === 1 ? "" : "s"} not priced` : ""].filter(Boolean).join(" · ") || "at list prices"),
        monthMini,
        h("div", { class: "mini-foot" }, top ? h("span", { class: "muted small" }, "Most used: ", h("code", {}, top.model), ` via ${top.upstream} (${fmt.n(top.requests)})`) : null, goto("usage", "All days →")));
    }).catch((e) => todayBox.replaceChildren(h("span", { class: "err small" }, e.message)));
    const heroActions = h("div", { class: "hero-actions small" },
      h("a", { href: "#destinations:upstreams", class: "golink", onclick: (e) => { e.preventDefault(); state.addUp = true; go("upstreams"); } }, "Add a destination →"),
      goto("models", "Compare models across providers →"), goto("usage", "Usage by month →"));
    // A provider set up that Filament has no list of models for (LD-D3) is almost there: its models are one click away.
    const unlisted = facts?.connected.unlisted || [];
    const hero = !setUp ? h("section", { class: "hero hero-setup" },
      h("div", { class: "hero-main" },
        h("div", { class: "hero-title" }, h("span", { class: "dot warn" }), h("h2", {}, unlisted.length ? "Almost set up: list your models" : "Not set up yet: connect a model")),
        h("p", { class: "muted" }, unlisted.length
          ? `Filament is running, but it has no list of your ${unlisted.length === 1 ? "provider's" : "providers'"} models yet, so no model can answer. List them, and the harness, your other tools and memory all use them.`
          : "Filament is running, but no model can answer yet. Connect one, and the harness, your other tools and memory all use it."),
        getStarted.steps(facts, gsOpts)))
    : h("section", { class: "hero" },
      h("div", { class: "hero-main" },
        h("div", { class: "hero-title" }, h("span", { class: `dot ${errRate > 0.1 ? "err" : "ok"}` }), h("h2", {}, errRate > 0.1 ? "Some requests are failing" : lastReq ? "Everything is flowing" : "Ready for your first request")),
        h("p", { class: "muted" }, `${enabledUps.length} upstream${enabledUps.length === 1 ? "" : "s"} enabled${agents.length ? `, ${agents.length} coding agent${agents.length === 1 ? "" : "s"}` : ""}, ${routesOn} route${routesOn === 1 ? "" : "s"}. ${lastReq ? `Last request ${fmt.t(lastReq.ts)} from ${lastReq.ua?.split("/")[0] || "an agent"} for ${lastReq.model}.` : "Point your agent at the address below to start."}`),
        h("div", { class: "kv hero-kv" }, h("span", {}, "Base URL for your agent"), copyline(`${base}/v1`), h("span", {}, "API key"), key ? secretLine(key) : h("i", { class: "muted" }, "none set")),
        enabledUps.length >= 2 ? (() => { // one switch for "if a provider fails or hits its limit, use the next one"
          const on = c.rules?.resilience?.failover === true; const withBackups = c.routes.filter((r) => r.enabled !== false && (r.fallbacks || []).length);
          const sw = h("label", { class: "switch", title: "Failover between providers" }, (() => { const cb = h("input", { type: "checkbox" }); cb.checked = on; cb.onchange = async () => { try { await ui.configFollow.own(async () => ui.configFollow.adopt((await api("/failover", { method: "POST", body: { enabled: cb.checked } })).version)); toast(cb.checked ? "Failover on: backups take over when a provider fails" : "Failover off: only the first provider of each route is used"); for (const cfgObj of [state.config, state.saved]) { if (cfgObj) ((cfgObj.rules ||= {}).resilience ||= {}).failover = cb.checked; } render(); } catch (/** @type {any} */ e) { toast(e.message, "err"); cb.checked = !cb.checked; } }; return cb; })(), h("span"));
          return h("div", { class: "failover-line" }, sw, h("div", {}, h("b", {}, `Failover between providers: ${on ? "on" : "off"}`),
            h("div", { class: "muted small" }, withBackups.length ? `${withBackups.length} route${withBackups.length === 1 ? " has" : "s have"} a failover order: ${withBackups.map((r) => `${r.match} → ${[r.upstream, ...r.fallbacks.map((f) => f.upstream)].map(upDisplay).join(" → ")}`).join(" · ")}` : "No route has a failover order yet: each model name goes to one provider only, and when that provider fails the client gets the error."),
            h("div", { class: "small", style: "margin-top:4px" }, goto("routes", "Set the order per model name on the Routes page →")),
            withBackups.length ? null : h("div", { class: "muted small", style: "margin-top:2px" }, "Tip: create a virtual model like ", h("code", {}, "free-model"), " that chains several providers' free models. ", goto("routes", "New virtual model →", "new-virtual"))));
        })() : null, heroActions),
      h("div", { class: "hero-side today-side" }, h("h3", {}, "Today so far"), todayBox));
    // ---- 7-day usage chart ----
    const dailyBox = h("div", {}, h("span", { class: "muted small" }, "loading…"));
    if (pane === "health") api("/usage/daily?days=7").then(({ days }) => {
      const W = 720, H = 120, n = days.length, bw = W / n; const maxT = Math.max(1, ...days.map((d) => d.input + d.output)); const maxC = Math.max(0.0001, ...days.map((d) => d.cost));
      const bars = days.map((d, i) => { const hIn = ((d.input) / maxT) * (H - 24), hOut = ((d.output) / maxT) * (H - 24); const x = i * bw + bw * 0.15, w = bw * 0.7; return `<rect class="bar in" x="${x.toFixed(1)}" y="${(H - 16 - hIn - hOut).toFixed(1)}" width="${w.toFixed(1)}" height="${hIn.toFixed(1)}"><title>${d.day}: ${d.input.toLocaleString()} input tokens</title></rect><rect class="bar out" x="${x.toFixed(1)}" y="${(H - 16 - hOut).toFixed(1)}" width="${w.toFixed(1)}" height="${hOut.toFixed(1)}"><title>${d.day}: ${d.output.toLocaleString()} output tokens · ${d.requests} requests · $${d.cost}</title></rect><text class="lbl" x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">${d.day.slice(5)}</text>`; }).join("");
      const costPts = days.map((d, i) => `${(i * bw + bw / 2).toFixed(1)},${(H - 16 - (d.cost / maxC) * (H - 30)).toFixed(1)}`).join(" ");
      const totals = days.reduce((a, d) => ({ req: a.req + d.requests, tok: a.tok + d.input + d.output, cost: a.cost + d.cost }), { req: 0, tok: 0, cost: 0 });
      dailyBox.replaceChildren(h("div", { html: `<svg class="spark daily" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}<polyline class="line" points="${costPts}"/></svg>` }), h("div", { class: "spark-legend" }, h("span", {}, h("i", { style: "background:var(--accent-2);opacity:.5" }), "input tokens"), h("span", {}, h("i", { style: "background:var(--accent)" }), "output tokens"), h("span", {}, h("i", { style: "background:var(--warn)" }), "cost"), h("span", { class: "grow" }), h("span", {}, `${fmt.n(totals.req)} requests · ${fmt.n(totals.tok)} tokens · ${fmt.usd(totals.cost)} this week`)));
    }).catch((e) => dailyBox.replaceChildren(h("span", { class: "err small" }, e.message)));
    const stats = h("div", { class: "grid4" },
        stat("Requests · 24h", fmt.n(s.requests), `${fmt.n(s.errors)} errors · ${fmt.pct(1 - errRate)} success`),
        stat("Tokens · 24h", fmt.n((s.tokens?.input || 0) + (s.tokens?.cacheRead || 0) + (s.tokens?.output || 0)), `${fmt.n((s.tokens?.input || 0) + (s.tokens?.cacheRead || 0))} in · ${fmt.n(s.tokens?.output)} out · ${fmt.n(s.tokens?.thinking)} thinking`),
        stat("Cache hit rate", fmt.pct(s.cacheHitRate), `${fmt.n(s.tokens?.cacheRead)} read · ${fmt.n(s.tokens?.cacheWrite)} written`),
        stat("Paid · 24h", fmt.usd(s.cost), s.listCostN && listDiffers(s.cost, s.listCost) ? `${fmt.usd(s.listCost)} at list price — a plan's requests pay $0` : "per token at list price; agent turns and plans pay through their subscriptions"));
    const livePanel = h("section", { class: "panel" }, h("h2", {}, "Live"), liveBox);
    const charts = h("div", { class: "cards two" }, h("section", { class: "card" }, h("h3", {}, "Last hour"), sparkBox), h("section", { class: "card" }, h("h3", {}, "Last 7 days"), dailyBox));
    const subsPanel = h("section", { class: "panel" }, h("h2", {}, "Subscriptions & quotas"), h("p", { class: "muted small" }, "What pays for each upstream, how much is left, and where requests go when it runs out. A coding agent's account and its plan's windows are as the agent last said them."), subsBox);
    const healthPanel = h("section", { class: "panel" }, h("h2", {}, "Upstream health · 24h"), healthBox);
    const agentsPanel = pane !== "agents" ? null : c.upstreams.some(isAgentUp) ? h("section", { class: "panel" }, h("h2", {}, "Agent sessions"), h("p", { class: "muted small" }, "Live agent processes Filament has started and the conversations mapped to agent sessions. A conversation is reused as long as the client keeps sending the same session id or the same first message."), (() => {
        const box = h("div", {}, h("span", { class: "muted" }, "loading…"));
        const load = () => api("/acp/status").then((s) => {
          const age = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${(ms / 3600000).toFixed(1)} h`);
          box.replaceChildren(
            h("h4", {}, `Processes (${s.processes.length})`),
            s.processes.length ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["upstream · model", "command", "pid", "idle", ""].map((x) => h("th", {}, x)))), h("tbody", {}, ...s.processes.map((p) => h("tr", {}, h("td", {}, h("code", {}, p.key.replace("|", " · ") || p.key)), h("td", { class: "muted" }, p.command), h("td", {}, p.pid ?? "–"), h("td", {}, age(p.idleMs)), h("td", {}, h("button", { class: "sm danger", title: "Stop this agent process; the next request starts a fresh one and reloads the session", onclick: () => api(`/acp/processes/${encodeURIComponent(p.key)}/kill`, { method: "POST" }).then(load) }, "stop"))))))) : h("p", { class: "muted small" }, "No agent process running. One starts with the first request."),
            (() => { // chats the agents themselves know about (Claude Code: everything started in its terminal)
              const wrap = h("details", { class: "subform lazy-sessions" }, h("summary", {}, "Continue a chat the agent already has (opens the agents' session lists)"), h("p", { class: "muted small" }, "Claude Code lists every chat you started in its own terminal. To carry one on from your chat client, use its model name with the session id after a #, for example ", h("code", {}, "claude-code/sonnet#3716601d"), ". The agent keeps its history; a session that is still open in a terminal must be closed first."));
              const box = h("div", {}, h("span", { class: "muted small" }, "asking the agents…")); wrap.append(box);
              const agentsWithList = state.config.upstreams.filter((u) => isAgentUp(u) && u.enabled !== false);
              let asked = false; wrap.addEventListener("toggle", () => { if (!wrap.open || asked) return; asked = true; Promise.all(agentsWithList.map((u) => api(`/acp/${encodeURIComponent(u.id)}/sessions`).then((r) => ({ u, r })).catch((e) => ({ u, r: { ok: false, error: e.message, sessions: [] } })))).then((all) => {
                const rows = all.flatMap(({ u, r }) => (r.sessions || []).slice(0, 25).map((x) => ({ u, x })));
                if (!rows.length) return box.replaceChildren(h("p", { class: "muted small" }, "No agent reported past sessions" + (all.some(({ r }) => r.error) ? ` (${all.filter(({ r }) => r.error).map(({ u, r }) => `${u.id}: ${r.error}`).join("; ")})` : ".")));
                const ago = (iso) => { if (!iso) return ""; const d = Date.now() - new Date(iso).getTime(); return d < 3600000 ? `${Math.max(1, Math.round(d / 60000))} min ago` : d < 86400000 ? `${(d / 3600000).toFixed(1)} h ago` : `${Math.round(d / 86400000)} d ago`; };
                const nameFor = (u) => { const pre = (state.config.routes || []).find((rt) => rt.upstream === u.id && rt.enabled !== false)?.match?.replace(/\*.*$/, "") || `${u.id}/`; return `${pre}${u.id === "claude-code" ? "sonnet" : "auto"}`; };
                box.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["agent", "chat", "folder", "last active", "use this model name in your client"].map((t) => h("th", {}, t)))), h("tbody", {}, ...rows.map(({ u, x }) => h("tr", {}, h("td", {}, (u.name || u.id).replace(" (agent via ACP)", "")), h("td", {}, x.title || h("i", { class: "muted" }, "untitled"), h("div", { class: "muted small mono" }, (x.sessionId || "").slice(0, 8))), h("td", { class: "muted small" }, x.cwd || "–"), h("td", { class: "muted small" }, ago(x.updatedAt)), h("td", {}, copyline(`${nameFor(u)}#${(x.sessionId || "").slice(0, 8)}`))))))));
              }); });
              return wrap;
            })(),
            (() => { const waiting = (s.turns || []).filter((t) => !t.done && (t.waiting.length || !t.attached)); if (!waiting.length) return document.createTextNode(""); // replaceChildren prints a null arg as text
              return h("div", {}, h("h4", {}, `Waiting for the client (${waiting.length})`), h("p", { class: "muted small" }, "The agent asked for the chat client's hands (a permission answer, a file, a command, a plan); Filament ended the reply with that tool call and continues the turn when the client comes back."),
                h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["agent", "asked the client for", "tool", "waiting since", "buffered output"].map((x) => h("th", {}, x)))), h("tbody", {}, ...waiting.map((t) => h("tr", {}, h("td", {}, t.upstreamId), h("td", {}, t.waiting.map((a) => a.kind).join(", ") || "—"), h("td", {}, t.waiting.map((a) => h("code", {}, a.tool)).flatMap((x, i) => (i ? [", ", x] : [x]))), h("td", {}, t.waiting.length ? `${Math.round(Math.max(...t.waiting.map((a) => a.ageMs)) / 1000)} s` : (t.detachedAt ? `${Math.round((Date.now() - t.detachedAt) / 1000)} s` : "—")), h("td", {}, String(t.buffered)))))))); })(),
            h("h4", {}, `Conversations (${s.conversations.length})`),
            s.conversations.length ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...[["session", ""], ["upstream", ""], ["model", ""], ["mode", ""], ["bridge in force", ""], ["turns", ""], ["folder", ""], ["last used", ""], ["raw", "the agent's own messages kept for this session (acp.rawMessages): its whole messages, and each result as it read it"], ["live", ""], ["", ""]].map(([x, tip]) => h("th", { title: tip || null }, x)))), h("tbody", {}, ...s.conversations.sort((a, b) => a.idleMs - b.idleMs).slice(0, 50).map((cv) => h("tr", {}, h("td", {}, cv.title ? h("div", {}, h("b", {}, String(cv.title).slice(0, 48)), h("div", { class: "muted small mono" }, (cv.sessionId || "").slice(0, 8))) : h("code", {}, (cv.sessionId || "").slice(0, 8))), h("td", {}, cv.upstreamId || "–"), h("td", {}, h("code", {}, cv.modelId || "default")), h("td", {}, cv.mode || "–", cv.commands?.length ? h("div", { class: "muted small", title: cv.commands.map((x) => "/" + x).join("  ") }, `${cv.commands.length} slash command${cv.commands.length === 1 ? "" : "s"}`) : null), h("td", {}, cv.bridge ? h("span", { class: cv.bridgeNote ? "pill warn" : "pill", title: `${BRIDGE_HINT[cv.bridge] || ""}${cv.bridgeNote ? "\n\nWhy not what the upstream is configured for: " + cv.bridgeNote : ""}` }, cv.bridge) : h("span", { class: "muted small", title: "No turn is being tracked for this conversation right now: either none has run since Filament started, or the one that ran has finished and been swept. The upstream's configured value is deliberately not shown as a substitute, because it may not be honoured." }, "not tracked")), h("td", {}, cv.turns), h("td", { class: "muted small" }, cv.cwd), h("td", {}, age(cv.idleMs) + " ago"), h("td", { class: "num" }, cv.raw ? h("button", { class: "sm ghost", type: "button", title: "Show the raw messages this session kept", onclick: () => openRawMessages(cv) }, fmt.n(cv.raw)) : h("span", { class: "muted" }, "–")), h("td", {}, cv.live ? h("span", { class: "pill ok" }, "loaded") : h("span", { class: "pill" }, "on disk")), h("td", {}, h("button", { class: "sm ghost", title: "Forget the mapping; the next message starts a new agent session seeded with the chat history", onclick: () => api(`/acp/conversations/${encodeURIComponent(cv.key)}`, { method: "DELETE" }).then(load) }, "forget"))))))) : h("p", { class: "muted small" }, "No conversations yet."),
            // §7.1 / P5: who actually did the work. When the chat client has no matching tool, Filament's own hands run
            // it on this machine under the upstream's permission policy — and the agent's card says so, since a user
            // who believes their client is doing the work (and applying its permission mode) has no other way to see
            // that it is not. `paged` shows what the agent got back was capped.
            h("div", {},
              h("h4", {}, `Agent tool calls (${(s.mcp || []).filter((m) => m.tool).length})`),
              (s.mcp || []).some((m) => m.tool) ? h("div", { class: "table-wrap" }, h("table", { class: "small" },
                h("thead", {}, h("tr", {}, ...["when", "tool", "who ran it", "agent got", "result"].map((x) => h("th", {}, x)))),
                h("tbody", {}, ...(s.mcp || []).filter((m) => m.tool).slice(0, 30).map((m) => h("tr", {},
                  h("td", { class: "muted small" }, new Date(m.at).toLocaleTimeString()),
                  h("td", {}, h("code", {}, m.tool)),
                  h("td", {}, m.via === "client"
                    ? h("span", { class: "pill ok", title: "Your chat client ran this with its own tool, so it rendered a native card and kept the full result." }, "your client")
                    : m.via === "filament"
                      ? h("span", { class: "pill warn", title: "Your chat client has no such tool, so Filament's own hands ran it on this machine under this upstream's permission policy. The client rendered no card for it." }, "Filament's hands")
                      : h("span", { class: "muted small" }, "–")),
                  h("td", { class: "muted small", title: "Capped on the way back to the agent, to keep its context smaller. When your client ran the call it keeps its own full copy; when Filament's hands ran it there is no client copy and the rest simply stayed on disk. acp.nativePaging / nativePageLines / nativePageChars control it." }, m.paged || "whole"),
                  h("td", {}, m.ok ? h("span", { class: "pill ok" }, "ok") : h("span", { class: "pill err", title: m.error || "" }, "error")),
                )))))
                : h("p", { class: "muted small" }, "No agent tool calls yet. These appear when an agent works through Filament's toolset — clientBridge native, on an agent that can switch its built-in tools off. What an agent delegates in full mode goes over ACP's own file and terminal methods instead, and is listed on the request record's Changes.")));
        }).catch((e) => box.replaceChildren(h("span", { class: "err" }, e.message)));
        load(); return box;
      })()) : empty("No coding agents connected", "Connect one in the harness's Settings › Coding agents.");
    // What each agent declared the last time Filament started it (HarnessV3-ACP AC0-1), kept, so no agent starts to
    // show it: every agent configured, in the config's order, one not read yet saying so. The agents that declare
    // themselves at start: an ACP agent and Codex (the Cursor SDK has no handshake).
    const acpUps = c.upstreams.filter((u) => u.type === "acp" || u.type === "codex");
    const profilesPanel = pane !== "agents" || !acpUps.length ? null : (() => {
      const box = h("div", {}, h("span", { class: "muted small" }, "loading…"));
      api("/acp/profiles").then(({ profiles }) => {
        box.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small" },
          h("thead", {}, h("tr", {}, ...[["agent", ""], ["declared by", "the name and version the agent gave"], ["read", "when Filament last started it and read its answer"], ["supports", "point at one for what it means here"]].map(([t, tip]) => h("th", { title: tip || null }, t)))),
          h("tbody", {}, ...acpUps.map((u) => {
            const p = profiles?.[u.id];
            const agent = h("td", {}, h("b", {}, (u.name || u.id).replace(" (agent via ACP)", "")), h("div", { class: "muted small mono" }, u.id));
            if (!p) return h("tr", {}, agent, h("td", { colspan: 3, class: "muted small" }, "Not read yet: it says what it supports the first time Filament starts it. Open its cheat sheet on Destinations, or send it a request."));
            const has = supportsRows(p).filter((r) => r.has);
            return h("tr", {}, agent,
              h("td", { class: "small" }, p.agent ? `${p.agent.title || p.agent.name}${p.agent.version ? ` ${p.agent.version}` : ""}` : h("span", { class: "muted" }, "no name given")),
              h("td", { class: "muted small", title: memWhen(p.at) }, memAgo(p.at)),
              h("td", {}, has.length ? h("div", { class: "chips-wrap" }, ...has.map((r) => h("span", { class: "pill ok", title: r.means }, r.word))) : h("span", { class: "muted small" }, "none declared")));
          })))));
      }).catch((e) => box.replaceChildren(h("span", { class: "err" }, e.message)));
      return h("section", { class: "panel" }, h("h2", {}, "What each agent supports"), h("p", { class: "muted small" }, "As each agent declared it the last time Filament started it, so none is started to show it here."), box);
    })();
    const byModelPanel = h("section", { class: "panel" }, h("h2", {}, "By model · 24h"), byModel.length ? h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "model"), ...["requests", "input", "cache read", "output", "thinking", "paid", "at list"].map((x) => h("th", { class: "num" }, x)))), h("tbody", {}, ...byModel.map(([m, v]) => h("tr", {}, h("td", {}, h("code", {}, m)), h("td", { class: "num" }, fmt.n(v.requests)), h("td", { class: "num" }, fmt.n(v.input)), h("td", { class: "num" }, fmt.n(v.cacheRead)), h("td", { class: "num" }, fmt.n(v.output)), h("td", { class: "num" }, fmt.n(v.thinking)), h("td", { class: "num" }, fmt.usd(v.cost)), h("td", { class: "num" }, v.listCostN ? fmt.usd(v.listCost) : "–")))))) : empty("No traffic yet", "Send a request from your agent and it will show up here."));
    const latestPanel = h("section", { class: "panel" }, h("h2", {}, "Latest requests"), h("p", { class: "muted small" }, "The ten most recent, a turn with its calls as one. ", goto("requests", "All traffic")), requestsTable(state.requests, { limit: 10 }));
    const connectPanel = h("section", { class: "panel" }, h("h2", {}, "Connect"), h("div", { class: "kv" }, h("span", {}, "Anthropic"), copyline(`${base}/v1/messages`), h("span", {}, "OpenAI"), copyline(`${base}/v1/chat/completions`), h("span", {}, "OpenAI Responses"), copyline(`${base}/v1/responses`), h("span", {}, "Models"), copyline(`${base}/v1/models`)), c.routes.length ? h("div", { class: "chips-wrap", style: "margin-top:12px" }, ...c.routes.map((r) => h("code", { class: `chip ${r.enabled === false ? "muted" : ""}`, title: routeMeaning(r, c) }, r.match))) : empty("No routes yet", "Connect a model: its provider comes with its route."));
    // ---- where you left off: the five most recent memory sessions; a one-line pointer when memory is off ----
    const leftWrap = h("div", {});
    if (pane === "status") {
      const leftBox = h("div", {}, h("span", { class: "muted small" }, "loading…"));
      leftWrap.append(h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Where you left off"), goto("sessions", "All sessions →")), leftBox));
      memStatus().then(async (st) => {
        if (!st.enabled) { leftWrap.replaceChildren(h("p", { class: "muted small", style: "margin:0 0 16px" }, "Memory is off — ", goto("memsettings", "turn it on"), " and Filament lists your recent sessions here, remembers what you decided, and lets any chat pick up where another left off.")); return; }
        const { sessions } = await api("/memory/sessions?limit=5");
        if (!sessions.length) { leftBox.replaceChildren(h("p", { class: "muted small", style: "margin:0" }, "No sessions archived yet. The first chat with memory on shows up here.")); return; }
        leftBox.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, ...["session", "project", "when", "state", ""].map((t) => h("th", {}, t)))), h("tbody", {}, ...sessions.map((s) => { const pw = projectWords({ id: s.project, name: s.projectName, cwd: s.cwd }); return h("tr", { class: "clickable", onclick: () => { state.memSel = s.id; go("sessions"); } },
          h("td", {}, h("b", {}, sessionWords(s)), h("div", { class: "muted small mono" }, `${s.id} · ${s.client || "?"} · ${fmt.n(s.turns)} turn${s.turns === 1 ? "" : "s"}`)),
          h("td", { class: "muted small", title: pw.title }, pw.text),
          h("td", { class: "muted small", style: "white-space:nowrap" }, s.when || "–"),
          h("td", {}, s.open?.length ? h("span", { class: "pill warn" }, `${s.open.length} open`) : s.state ? h("span", { class: "pill ok" }, "wrapped up") : h("span", { class: "pill" }, "no end state yet"), s.state ? h("div", { class: "muted small mem-text", style: "max-width:44ch" }, s.state) : null),
          h("td", {}, memSessionLink(s.id, "Open →"))); })))));
      }).catch((e) => leftBox.replaceChildren(h("span", { class: "err small" }, e.message)));
    }
    if (pane === "health") return h("div", {}, charts, subsPanel, healthPanel);
    // The agents are connected, installed and signed in in the harness (HarnessV3-ACP AC3-8); this pane reads them.
    const agentsLead = h("p", { class: "muted small", style: "margin:0 0 16px" }, "Connect, install and sign in coding agents in the harness's ", h("a", { href: "/ui/harness.html#/settings/agents" }, "Settings › Coding agents"), ". Here: what each one supports, and the sessions Filament keeps with them.");
    if (pane === "agents") return h("div", {}, agentsLead, profilesPanel, agentsPanel);
    if (pane === "latest") return h("div", {}, stats, byModelPanel, latestPanel);
    return h("div", { class: "home" }, getStartedAbove, hero, h("div", { class: "home-grid" }, livePanel, connectPanel), leftWrap, h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Latest"), goto("requests", "All →")), requestsTable(state.requests, { limit: 8 })));
}
