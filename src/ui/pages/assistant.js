// @ts-check
import { ui } from "../runtime.js";
import { holdWhileShown } from "../lib/put-away.js";
import { viewOnlyNow, VIEW_ONLY_REFUSED } from "../lib/api.js";

export function assistant() {
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
    mergedRules, idInput, pingResult, memStatus, memAgo, memWhen,
    memBytes, memPrefix, memEnginePill, memKindPill, memLineageSvg, memSessionLink,
    memOffPanel, memGate, memJobPanel, memBackupsPanel, memImportPanel, memBackfillControl,
    memResultsTable, memSummary, commandsDoc,
    memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h, $,
    store, md, mdDoc, mdBlock, esc, setHtml,
    statusPill, phaseOf,
  } = /** @type {any} */ (ui);


    const A = (state.assistant ||= { sessionId: store.get("assistant.session") || null, model: store.get("assistant.model") || "", transcript: [], pending: [], valid: true, busy: false, models: [] });
    const log = h("div", { class: "chat-log" });
    const pendingBox = h("div", { class: "pending" });
    const status = h("span", { class: "muted small" });
    const modelSel = h("select", { title: "Which model answers. Any non-agent route works; Claude models understand the tools best." });
    const input = h("textarea", { rows: 3, placeholder: "Ask anything about your setup, or tell me what to change. Example: “route glm-* to my OpenRouter upstream and make thinking visible”" });
    const sendBtn = h("button", { class: "primary" }, "Send");
    const bubble = (role, text) => h("div", { class: `bubble ${role}` }, h("div", { class: "bubble-body", html: mdBlock(text) }));
    const toolChip = (t) => h("details", { class: `tool-chip ${t.isError || t.ok === false ? "bad" : ""}` }, h("summary", {}, `⚙ ${t.name}`, t.input && Object.keys(t.input).length ? h("span", { class: "muted small" }, " " + JSON.stringify(t.input).slice(0, 120)) : null),
      t.name === "open_page" && t.input?.page ? h("div", { style: "padding:2px 0 6px" }, h("button", { class: "sm", onclick: () => go(t.input.page) }, `Open ${(HUBS[t.input.page]?.[0]) || t.input.page} →`, t.input.why ? h("span", { class: "muted" }, ` — ${t.input.why}`) : null)) : null,
      t.result != null || t.summary != null ? h("pre", { class: "small" }, t.result ?? t.summary) : null);
    const drawLog = () => {
      log.replaceChildren(...(A.transcript.length ? A.transcript.map((m) => (m.role === "tool" ? toolChip(m) : m.role === "system" ? h("div", { class: "bubble system" }, m.text) : bubble(m.role, m.text))) : [h("div", { class: "empty" }, h("b", {}, "Start a conversation"), h("span", { class: "small" }, "Try one of the suggestions below. The assistant sees your current config, every parameter's documentation, the templates and the model list."))]));
      log.scrollTop = log.scrollHeight;
    };
    const drawPending = () => {
      const n = A.pending.length;
      pendingBox.replaceChildren(h("div", { class: "pending-head" }, h("b", {}, n ? `${n} pending change${n > 1 ? "s" : ""}` : "No pending changes"), h("span", { class: "grow" }), n ? h("button", { class: "sm", onclick: () => api("/assistant/discard", { method: "POST", body: { sessionId: A.sessionId } }).then(refresh) }, "Discard") : null, n ? h("button", { class: `sm primary ${A.valid ? "" : "disabled"}`, disabled: A.valid ? null : "", title: A.valid ? "Save these changes to config.json" : "The draft has validation errors; ask the assistant to fix them", onclick: async () => { try { const r = await api("/assistant/apply", { method: "POST", body: { sessionId: A.sessionId } }); toast(`Applied ${r.changes.length} change(s)`); await loadAll({ force: true }); state.tab = "assistant"; render(); } catch (/** @type {any} */ e) { toast(e.message, "err"); } } }, "Apply") : null),
        n ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, h("th", {}, "setting"), h("th", {}, "from"), h("th", {}, "to"))), h("tbody", {}, ...A.pending.map((d) => h("tr", {}, h("td", {}, h("code", {}, d.path)), h("td", {}, h("code", {}, JSON.stringify(d.from))), h("td", {}, h("code", {}, JSON.stringify(d.to)))))))) : h("p", { class: "muted small" }, "When the assistant changes something, the exact settings appear here for you to review before saving."));
    };
    const refresh = async () => {
      const s = await api(`/assistant/session${A.sessionId ? "?id=" + encodeURIComponent(A.sessionId) : ""}`);
      A.sessionId = s.sessionId; store.set("assistant.session", s.sessionId); A.transcript = s.transcript; A.pending = s.pendingChanges; A.valid = s.valid; if (s.model && !A.model) A.model = s.model;
      drawLog(); drawPending();
    };
    const loadModels = async () => {
      const m = await api("/assistant/models"); A.models = m.models;
      const preferred = A.model || m.models.find((x) => /claude-(opus|sonnet)-5|fable/i.test(x.id))?.id || m.models[0]?.id || "";
      modelSel.replaceChildren(...m.models.map((x) => h("option", { value: x.id, selected: x.id === preferred ? "" : null }, `${x.id}  (${x.upstream})`)));
      A.model = preferred; modelSel.onchange = () => { A.model = modelSel.value; store.set("assistant.model", A.model); };
      if (!m.models.length) status.textContent = "No usable model: add a non-agent upstream and route first.";
    };
    const stopBtn = h("button", { class: "danger hidden", title: "Stop waiting for this answer" }, "Stop");
    const setBusy = (on, what = "") => { A.busy = on; sendBtn.disabled = on; input.disabled = on; stopBtn.classList.toggle("hidden", !on); input.placeholder = on ? "Working on your last message…" : "Ask anything about your setup, or tell me what to change. Example: “route glm-* to my OpenRouter upstream and make thinking visible”"; status.replaceChildren(on ? h("span", { class: "working" }, h("span", { class: "pulse" }), what || "thinking…") : ""); };
    const send = async (text) => {
      if (!text.trim()) return;
      // Its stream's POST goes past the client: a view-only device's page asks it of no one (lib/api.js).
      if (viewOnlyNow()) { toast(VIEW_ONLY_REFUSED, "err"); return; }
      if (A.busy) { toast("Still working on the previous message. Press Stop to give up on it.", "err"); return; }
      if (!A.model) { toast("Pick an answering model first", "err"); return; }
      setBusy(true);
      A.transcript.push({ role: "user", text }); drawLog(); input.value = "";
      const live = h("div", { class: "bubble assistant working" }, h("span", { class: "dots" }, h("i"), h("i"), h("i")), h("span", { class: "muted small live-what" }, "reading your setup…")); log.append(live); log.scrollTop = log.scrollHeight;
      const setWhat = (t) => { const el = live.querySelector(".live-what"); if (el) el.textContent = t; status.replaceChildren(h("span", { class: "working" }, h("span", { class: "pulse" }), t)); };
      A.aborter = new AbortController();
      // Put away, the page lets the request go (ui/lib/put-away.js); brought back, it loads afresh.
      const letGo = holdWhileShown(() => A.aborter?.abort());
      try {
        const r = await fetch("/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json", "x-filament-ui": "1" }, body: JSON.stringify({ sessionId: A.sessionId, message: text, model: A.model }), signal: A.aborter.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        if (!r.body) throw new Error("empty reply");
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf("\n\n")) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const line = block.split("\n").find((l) => l.startsWith("data:")); if (!line) continue; let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if (ev.type === "session") { A.sessionId = ev.sessionId; store.set("assistant.session", ev.sessionId); }
            else if (ev.type === "text") { live.remove(); A.transcript.push({ role: "assistant", text: ev.text }); drawLog(); log.append(live); }
            else if (ev.type === "tool") { setWhat(`using ${ev.name}…`); A.transcript.push({ role: "tool", name: ev.name, input: ev.input }); drawLog(); log.append(live); }
            else if (ev.type === "tool_result") { const t = [...A.transcript].reverse().find((m) => m.role === "tool" && m.name === ev.name && m.result == null); if (t) { t.result = ev.summary; t.ok = ev.ok; } drawLog(); log.append(live); }
            else if (ev.type === "error") { live.remove(); A.transcript.push({ role: "system", text: `Error: ${ev.message}` }); drawLog(); }
            else if (ev.type === "done") { A.pending = ev.pendingChanges; A.valid = ev.valid; drawPending(); }
            log.scrollTop = log.scrollHeight; }
        }
      } catch (/** @type {any} */ e) { A.transcript.push({ role: "system", text: e.name === "AbortError" ? "Stopped waiting for that answer." : `Error: ${e.message}` }); }
      letGo(); live.remove(); setBusy(false); drawLog(); input.focus(); refresh().catch(() => {});
    };
    stopBtn.onclick = () => A.aborter?.abort();
    sendBtn.onclick = () => send(input.value);
    // An Enter that ends an IME composition picks the word; it sends nothing.
    input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(input.value); } };
    const suggestions = ["Explain my current setup in plain words", "How does memory decide what to inject into my chats?", "What did I spend on models in the last 24 hours?", "Make thinking visible and effort xhigh for all Claude models", "Add a route so glm-* goes to my OpenAI-compatible upstream", "Why did my last request fail?", "Set up Cursor as a model with plan mode by default", "Turn on cost guard: cap effort at high and max_tokens at 32k"];
    loadModels().then(() => {
      if (!A.models.length) log.prepend(h("div", { class: "empty", style: "margin-bottom:10px" }, h("b", {}, "The Assistant needs one model to think with"), h("span", { class: "small" }, "It answers through Filament itself, so first connect a model: a provider's API key, a subscription you already pay for, or a coding agent on this machine. Then come back and let it configure the rest for you."), h("div", { style: "margin-top:8px" }, h("a", { href: "#destinations:upstreams", class: "golink", onclick: (e) => { e.preventDefault(); state.addUp = true; go("upstreams"); } }, "Connect a model →"))));
    }).catch((e) => (status.textContent = e.message));
    return h("div", { class: "assistant" },
      h("div", { class: "chat-col" },
        h("div", { class: "toolbar" }, h("label", {}, "answering model ", modelSel), h("span", { class: "grow" }), status, h("button", { class: "sm", title: "Forget this conversation and its draft", onclick: async () => { let r; try { r = await api("/assistant/reset", { method: "POST", body: { sessionId: A.sessionId } }); } catch (/** @type {any} */ e) { return toast(e.message, "err"); } A.sessionId = r.sessionId; store.set("assistant.session", r.sessionId); A.transcript = []; A.pending = []; drawLog(); drawPending(); } }, "New chat")),
        log,
        h("div", { class: "chips" }, ...suggestions.map((s) => h("button", { class: "sm ghost", onclick: () => send(s) }, s))),
        h("div", { class: "chat-input" }, input, h("div", { class: "chat-btns" }, sendBtn, stopBtn)),
        h("p", { class: "muted small", style: "margin:6px 0 0" }, "The answering model must support tool calling, so coding agents (Cursor, Claude Code, Qoder CLI, Codex) are not offered here: agents run their own tools and cannot drive Filament's. Hide models you never want in this list with the eye icon on the Upstreams page.")),
      h("div", { class: "side-col" }, h("section", { class: "panel" }, h("h2", {}, "Review before saving"), pendingBox), h("section", { class: "panel small muted" }, h("h2", {}, "What the assistant can do"), h("ul", {}, h("li", {}, "Read your config, the parameter docs, templates, advertised models and recent requests."), h("li", {}, "Edit a draft: rules, routes, upstreams, templates. It cannot type API keys; paste those on the Upstreams page."), h("li", {}, "Dry-run a request against the draft and test upstreams."), h("li", {}, "Answer from the shipped guides: memory, routes, rules, failover, backups — ask “how does X work”."), h("li", {}, "See live data: usage and cost, alerts, memory status, sessions and learned items. Remember/forget and learn-now act immediately, config changes wait for Apply."), h("li", {}, "Open the right page for you when the answer lives on one."), h("li", {}, "It answers through the model you pick, routed by Filament like any other request, so it appears on the Requests page.")))));
}
