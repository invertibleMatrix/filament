// @ts-check
import { ui } from "../runtime.js";
import { holdWhileShown } from "../lib/put-away.js";
import { kindOf } from "../lib/upstream-kinds.js";
import { viewOnlyNow, VIEW_ONLY_REFUSED } from "../lib/api.js";

export function dryrun() {
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


    const example = { model: "claude-opus-5-xhigh", max_tokens: 1024, stream: true, thinking: { type: "enabled", budget_tokens: 32000 }, output_config: { effort: "high" }, system: [{ type: "text", text: "You are a coding agent." }], messages: [{ role: "user", content: "hello" }] };
    const fmtSel = h("select", {}, h("option", { value: "anthropic" }, "anthropic (/v1/messages)"), h("option", { value: "openai" }, "openai (/v1/chat/completions)"));
    const ta = h("textarea", { class: "mono", rows: 14 }, JSON.stringify(example, null, 2));
    const hdr = h("input", { type: "text", class: "mono", placeholder: '{"anthropic-beta":"..."}' });
    const out = h("div", {}, h("p", { class: "muted" }, "Nothing run yet."));
    const run = async () => { let body, headers = {}; try { body = JSON.parse(ta.value); if (hdr.value.trim()) headers = JSON.parse(hdr.value); } catch { return toast("Invalid JSON", "err"); } let r; try { r = await api("/dry-run", { method: "POST", body: { format: fmtSel.value, body, headers } }); } catch (/** @type {any} */ e) { return toast(e.message, "err"); } out.replaceChildren(r.ok ? h("div", {}, h("p", {}, `Route `, h("code", {}, r.route), ` → upstream `, h("code", {}, r.upstream), ` at `, h("code", {}, r.url)), h("h4", {}, "Changes"), r.changes.length ? h("ul", {}, ...r.changes.map((c) => h("li", {}, c))) : h("p", { class: "muted" }, "no changes"), h("h4", {}, "Body sent upstream"), h("pre", {}, JSON.stringify(r.body, null, 2)), h("h4", {}, "Headers sent upstream"), h("pre", {}, JSON.stringify(r.headers, null, 2))) : h("p", { class: "err" }, r.error)); };
    return h("div", {}, h("section", { class: "panel" }, h("h2", {}, "Request"), h("p", { class: "muted" }, "Paste a request exactly as an agent would send it. Nothing is forwarded; you see the route decision, every change the rules made, and the body and headers that would go upstream."), h("div", { class: "row" }, h("label", {}, "format ", fmtSel), h("label", { class: "grow" }, "inbound headers (JSON, optional) ", hdr), h("button", { class: "primary", onclick: run }, "Run dry run")), ta), h("section", { class: "panel" }, h("h2", {}, "Result"), out));
}

export function playground() {
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
    memKnewCard, memTimelineCard, memBenchmarkPanels, fmt, h, store,
    md, mdDoc, mdBlock, esc, setHtml, statusPill,
    phaseOf,
  } = /** @type {any} */ (ui);


    const P = (state.pg ||= { client: "anthropic", endpoint: "chat", model: "", effort: "", mode: "", stream: true, prompt: "Reply with one short sentence: what model are you and who runs you?", system: "", image: null, maxTokens: null, showRaw: false, raw: "", adv: false });
    const base = `${location.protocol}//${location.host}`; const key = state.keys?.[0] || "";
    const ENDPOINTS = {
      anthropic: [["chat", "POST /v1/messages", "Send a chat message the way Claude Code does"], ["count", "POST /v1/messages/count_tokens", "Ask how many input tokens a request would use"], ["models", "GET /v1/models", "The model list an Anthropic-style picker sees"]],
      openai: [["chat", "POST /v1/chat/completions", "Send a chat message the way an OpenAI-style client does"], ["models", "GET /v1/models", "The model list an OpenAI-style picker sees"], ["embeddings", "POST /v1/embeddings", "Turn text into a vector on an OpenAI-compatible upstream"]],
      responses: [["chat", "POST /v1/responses", "Send a message the way a Responses-API client (Codex CLI, OpenAI Agents SDK) does"], ["models", "GET /v1/models", "The model list an OpenAI-style picker sees"]],
    };
    if (!ENDPOINTS[P.client].some(([k]) => k === P.endpoint)) P.endpoint = "chat";
    const isChat = P.endpoint === "chat", isCount = P.endpoint === "count", isModels = P.endpoint === "models", isEmb = P.endpoint === "embeddings";
    const modelName = () => `${P.model}${P.effort ? "-" + P.effort : ""}${P.mode ? "@" + P.mode : ""}`;
    // What a reply may write (HarnessV4_Tasks decision 12): the box's number, else the most the model can write — its
    // own ceiling, the number Filament's own calls ask for (the model list's `outputCeiling`). Where Filament knows none,
    // Anthropic's format, which requires one, takes Filament's default (`outputDefault`); the others leave the field
    // out, and the provider's own limit applies. Null: left out.
    /** @type {Map<string, number>} */
    const ceilings = new Map();
    let outputDefault = 0;
    const outTokens = () => P.maxTokens || ceilings.get(P.model) || (P.client === "anthropic" ? outputDefault || null : null);
    // ---- the request exactly as a client would send it ----
    const buildRequest = () => {
      const H = { "content-type": "application/json" };
      if (P.client === "anthropic") { H["x-api-key"] = key; H["anthropic-version"] = "2023-06-01"; } else H["authorization"] = `Bearer ${key}`;
      if (isModels) return { method: "GET", path: "/v1/models", headers: P.client === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { authorization: `Bearer ${key}` }, body: null };
      if (isEmb) return { method: "POST", path: "/v1/embeddings", headers: H, body: { model: modelName(), input: P.prompt } };
      const img = P.image;
      if (P.client === "anthropic") {
        const content = img ? [{ type: "text", text: P.prompt }, { type: "image", source: { type: "base64", media_type: img.type, data: img.data } }] : P.prompt;
        const n = outTokens();
        /** @type {Record<string, any>} */
        const body = { model: modelName(), ...(n ? { max_tokens: n } : {}), messages: [{ role: "user", content }] };
        if (P.system) body.system = P.system; if (isChat) body.stream = !!P.stream;
        return { method: "POST", path: isCount ? "/v1/messages/count_tokens" : "/v1/messages", headers: H, body };
      }
      if (P.client === "responses") { const input = img ? [{ role: "user", content: [{ type: "input_text", text: P.prompt }, { type: "input_image", image_url: `data:${img.type};base64,${img.data}` }] }] : P.prompt; const n = outTokens(); const body = /** @type {Record<string, any>} */ ({ model: modelName(), input, ...(n ? { max_output_tokens: n } : {}), stream: !!P.stream }); if (P.system) body.instructions = P.system; return { method: "POST", path: "/v1/responses", headers: H, body }; }
      const content = img ? [{ type: "text", text: P.prompt }, { type: "image_url", image_url: { url: `data:${img.type};base64,${img.data}` } }] : P.prompt;
      const n = outTokens();
      /** @type {Record<string, any>} */
      const body = { model: modelName(), ...(n ? { max_tokens: n } : {}), stream: !!P.stream, messages: [...(P.system ? [{ role: "system", content: P.system }] : []), { role: "user", content }] };
      if (P.stream) body.stream_options = { include_usage: true };
      return { method: "POST", path: "/v1/chat/completions", headers: H, body };
    };
    const shortBody = (b) => JSON.stringify(b, (k, v) => (k === "data" && typeof v === "string" && v.length > 80 ? `${v.slice(0, 40)}… (${v.length} chars)` : k === "url" && typeof v === "string" && v.startsWith("data:") ? `${v.slice(0, 50)}… (${v.length} chars)` : v), 2);
    const curlFor = (r) => { const hs = Object.entries(r.headers).map(([k, v]) => `-H "${k}: ${v}"`).join(" "); return r.body ? `curl.exe ${base}${r.path} ${hs} -d '${JSON.stringify(r.body).replace(/'/g, "'\\''")}'` : `curl.exe ${base}${r.path} ${hs}`; };
    const psFor = (r) => { const hs = `@{ ${Object.entries(r.headers).filter(([k]) => k !== "content-type").map(([k, v]) => `"${k}" = "${v}"`).join("; ")} }`; return r.body ? `Invoke-RestMethod -Method Post -Uri "${base}${r.path}" -Headers ${hs} -ContentType "application/json" -Body '${JSON.stringify(r.body).replace(/'/g, "''")}'` : `Invoke-RestMethod -Uri "${base}${r.path}" -Headers ${hs}`; };

    // ---- controls ----
    const seg = (opts, val, on) => h("div", { class: "seg" }, ...opts.map(([v, l, tip]) => h("button", { class: v === val ? "on" : "", title: tip || "", onclick: () => { on(v); render(); } }, l)));
    const clientSeg = seg([["anthropic", "Anthropic-style client", "Claude Code, Anthropic SDKs: x-api-key header, /v1/messages"], ["openai", "OpenAI-style client", "OpenAI SDKs, Continue, Open WebUI, LM Studio clients: Bearer key, /v1/chat/completions"], ["responses", "Responses-API client", "Codex CLI, the OpenAI Agents SDK, newer OpenAI SDK calls: Bearer key, /v1/responses"]], P.client, (v) => (P.client = v));
    const epSeg = seg(ENDPOINTS[P.client].map(([k, l, tip]) => [k, l, tip]), P.endpoint, (v) => (P.endpoint = v));
    const c = (id) => state.config.upstreams.find((u) => u.id === id);
    const modelSel = h("select", {}, h("option", { value: "" }, "pick a model name…")); const modelIn = h("input", { type: "text", class: "mono", value: P.model, placeholder: "or type any name, e.g. direct/claude-sonnet-5" }); modelIn.oninput = () => { P.model = modelIn.value.trim(); modelSel.value = ""; preview(); };
    api("/models").then((m) => { const byUp = {}; for (const x of m.models) { if (x.source !== "effort-variant") (byUp[x.upstream] ||= []).push(x.id); if (Number(x.outputCeiling) > 0) ceilings.set(x.id, Number(x.outputCeiling)); } outputDefault = Number(m.outputDefault) || 0; for (const [up, names] of Object.entries(byUp)) { const g = h("optgroup", { label: `${upLabel(c(up))}` }); for (const n of names.slice(0, 80)) g.append(h("option", { value: n, selected: n === P.model ? "" : null }, n)); modelSel.append(g); } if (!P.model && m.models[0]) { P.model = m.models[0].id; modelIn.value = P.model; modelSel.value = P.model; } preview(); }).catch(() => {});
    modelSel.onchange = () => { P.model = modelSel.value; modelIn.value = P.model; preview(); };
    const effortSel = h("select", {}, ...[["", "no effort suffix (client default)"], ["low", "-low"], ["medium", "-medium"], ["high", "-high"], ["xhigh", "-xhigh"], ["max", "-max"]].map(([v, l]) => h("option", { value: v, selected: v === P.effort ? "" : null }, l))); effortSel.onchange = () => { P.effort = effortSel.value; preview(); };
    const modeSel = h("select", {}, ...[["", "no mode suffix"], ["agent", "@agent"], ["plan", "@plan"], ["ask", "@ask"]].map(([v, l]) => h("option", { value: v, selected: v === P.mode ? "" : null }, l))); modeSel.onchange = () => { P.mode = modeSel.value; preview(); };
    const streamCb = h("input", { type: "checkbox" }); streamCb.checked = P.stream; streamCb.onchange = () => { P.stream = streamCb.checked; preview(); };
    const maxIn = h("input", { type: "number", min: "1", value: P.maxTokens ?? "", style: "max-width:130px", title: "Empty: the most the model can write, its own ceiling (the number Filament's own calls ask for). Where Filament knows none, an OpenAI-style request leaves the field out, so the provider's own limit applies; Anthropic's needs a number, so Filament's default goes. A number of yours caps the reply." });
    // The box says what empty sends for the model chosen.
    const paintMax = () => { const n = ceilings.get(P.model) || (P.client === "anthropic" ? outputDefault : 0); maxIn.placeholder = n ? `most: ${n.toLocaleString("en-US")}` : "its own limit"; };
    maxIn.onchange = () => { const v = Math.floor(Number(maxIn.value)); P.maxTokens = v > 0 ? v : null; if (!P.maxTokens) maxIn.value = ""; preview(); };
    const promptTa = h("textarea", { rows: 4 }, P.prompt); promptTa.oninput = () => { P.prompt = promptTa.value; preview(); };
    const sysTa = h("textarea", { rows: 2, placeholder: "optional system prompt. For a coding agent, include a line like: Working directory: C:\\path\\to\\project" }, P.system); sysTa.oninput = () => { P.system = sysTa.value; preview(); };
    const imgIn = h("input", { type: "file", accept: "image/*" }); const imgInfo = h("span", { class: "muted small" }, P.image ? `${P.image.name} (${Math.round(P.image.size / 1024)} KB) attached` : "no image");
    imgIn.onchange = () => { const f = imgIn.files?.[0]; if (!f) { P.image = null; imgInfo.textContent = "no image"; preview(); return; } const rd = new FileReader(); rd.onload = () => { P.image = { name: f.name, type: f.type || "image/png", size: f.size, data: String(rd.result).split(",")[1] }; imgInfo.textContent = `${f.name} (${Math.round(f.size / 1024)} KB) attached`; preview(); }; rd.readAsDataURL(f); };
    const clearImg = h("button", { class: "sm ghost", onclick: () => { P.image = null; imgIn.value = ""; imgInfo.textContent = "no image"; preview(); } }, "remove");

    // ---- preview + send ----
    const previewBox = h("pre", { class: "small", style: "max-height:260px" }); const curlBox = h("pre", { class: "small", style: "max-height:120px;white-space:pre-wrap;word-break:break-all" });
    let curlMode = "curl"; const curlSeg = h("div", { class: "seg small" }, h("button", { class: "on", onclick: (e) => { curlMode = "curl"; e.target.parentNode.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target)); preview(); } }, "curl"), h("button", { onclick: (e) => { curlMode = "ps"; e.target.parentNode.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target)); preview(); } }, "PowerShell"));
    const preview = () => { paintMax(); const r = buildRequest(); previewBox.textContent = `${r.method} ${base}${r.path}\n${Object.entries(r.headers).map(([k, v]) => `${k}: ${k === "x-api-key" || k === "authorization" ? v.replace(/(sk-[a-z]+-)[^ ]{4}[^ ]*/i, "$1••••") : v}`).join("\n")}${r.body ? "\n\n" + shortBody(r.body) : ""}`; curlBox.textContent = curlMode === "curl" ? curlFor(r) : psFor(r); };
    preview();
    const out = h("div", { class: "pg-out" }, h("p", { class: "muted small" }, "Nothing sent yet. The reply appears here exactly as your client would receive it, plus what Filament did with the request."));
    const sendBtn = h("button", { class: "primary" }, "Send");
    let aborter = null; const stopBtn = h("button", { class: "danger hidden", onclick: () => aborter?.abort() }, "Stop");
    const send = async () => {
      // A request sent from here is a model's call on this machine: a view-only device's page sends none (lib/api.js).
      if (viewOnlyNow()) return toast(VIEW_ONLY_REFUSED, "err");
      const r = buildRequest(); if (!isModels && !P.model) return toast("Pick or type a model name first", "err");
      aborter = new AbortController(); sendBtn.disabled = true; stopBtn.classList.remove("hidden");
      // Put away, the page lets the request go (ui/lib/put-away.js); brought back, it loads afresh.
      const letGo = holdWhileShown(() => aborter?.abort());
      const t0 = performance.now(); let ttft = null; const text = h("div", { class: "pg-text" }), think = h("details", { class: "pg-think" }, h("summary", {}, "thinking"), h("div", {})), events = h("pre", { class: "small", style: "max-height:220px" }), status = h("div", { class: "row", style: "margin:0 0 8px;align-items:center;gap:8px" }, h("span", { class: "pill pending" }, "sending…")), recBox = h("div", {});
      out.replaceChildren(status, text, think, h("details", { class: "subform", style: "margin-top:10px" }, h("summary", {}, "Raw response as the client sees it"), events), recBox);
      let thinkText = "", answer = "", usage = null, httpStatus = 0, requestId = null, rawLines = [];
      try {
        const res = await fetch(`${base}${r.path}`, { method: r.method, headers: /** @type {any} */ (r.headers), body: r.body ? JSON.stringify(r.body) : undefined, signal: aborter.signal });
        httpStatus = res.status; requestId = res.headers.get("x-filament-request-id");
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text/event-stream")) {
          if (!res.body) throw new Error("empty stream");
          const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
          for (;;) { const { value, done } = await reader.read(); if (done) break; if (ttft == null) ttft = performance.now() - t0; buf += dec.decode(value, { stream: true }); let nl; while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1); if (!line.startsWith("data:")) continue; const raw = line.slice(5).trim(); rawLines.push(raw); if (rawLines.length <= 400) events.textContent += raw.slice(0, 300) + (raw.length > 300 ? "…" : "") + "\n"; if (raw === "[DONE]") continue; let j; try { j = JSON.parse(raw); } catch { continue; }
              if (P.client === "anthropic") { if (j.type === "content_block_delta") { if (j.delta?.type === "text_delta") answer += j.delta.text; else if (j.delta?.type === "thinking_delta") thinkText += j.delta.thinking; } else if (j.type === "message_start") usage = { ...(usage || {}), ...(j.message?.usage || {}) }; else if (j.type === "message_delta") usage = { ...(usage || {}), ...(j.usage || {}) }; else if (j.type === "error") answer += `\n[error] ${j.error?.message || ""}`; }
              else if (P.client === "responses") { if (j.type === "response.output_text.delta") answer += j.delta || ""; else if (j.type === "response.reasoning_summary_text.delta") thinkText += j.delta || ""; else if (j.type === "response.completed" || j.type === "response.incomplete") usage = j.response?.usage || usage; else if (j.type === "error") answer += `\n[error] ${j.message || ""}`; else if (j.type === "response.failed") answer += `\n[error] ${j.response?.error?.message || ""}`; }
              else { const d = j.choices?.[0]?.delta || {}; if (d.content) answer += d.content; if (d.reasoning_content) thinkText += d.reasoning_content; if (j.usage) usage = j.usage; if (j.error) answer += `\n[error] ${j.error.message || JSON.stringify(j.error)}`; }
              text.textContent = answer; think.querySelector("div").textContent = thinkText; think.classList.toggle("hidden", !thinkText); } }
        } else {
          const t = await res.text(); ttft = performance.now() - t0; let j = null; try { j = JSON.parse(t); } catch {} events.textContent = j ? JSON.stringify(j, null, 2).slice(0, 20000) : t.slice(0, 20000);
          if (isModels && j) { const list = j.data || j.models || []; answer = ""; const byUp = {}; for (const x of list) (byUp[x.upstream || x.owned_by || "?"] ||= []).push(x);
            const filt = h("input", { type: "text", placeholder: "filter names", style: "max-width:240px" }); const tblBox = h("div", {});
            const drawModels = () => { const q = filt.value.trim().toLowerCase(); tblBox.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, h("th", {}, "name your client can ask for"), h("th", {}, "comes from"), h("th", {}, "that upstream receives"))), h("tbody", {}, ...list.filter((x) => !q || x.id.toLowerCase().includes(q)).slice(0, 400).map((x) => { const up = c(x.upstream || x.owned_by); return h("tr", {}, h("td", {}, h("code", {}, x.id)), h("td", {}, h("b", {}, up ? (up.name || up.id).replace(" (agent via ACP)", "") : x.upstream || x.owned_by || "?"), h("span", { class: "muted small" }, up ? ` · ${kindOf(up)}` : "")), h("td", { class: "muted" }, h("code", {}, x.upstream_model || "–"))); }))))); };
            filt.oninput = drawModels; drawModels();
            text.style.whiteSpace = "normal"; text.replaceChildren(h("div", { class: "row", style: "margin:0 0 8px;align-items:center" }, h("b", {}, `${list.length} model names`), h("span", { class: "muted small" }, Object.entries(byUp).map(([u, l]) => `${(c(u)?.name || u).replace(" (agent via ACP)", "")} ${l.length}`).join(" · ")), h("span", { class: "grow" }), filt), tblBox); }
          else if (isCount && j) answer = `input_tokens: ${j.input_tokens}`;
          else if (isEmb && j) answer = j.data ? `${j.data.length} embedding(s), ${j.data[0]?.embedding?.length || 0} dimensions each` : t.slice(0, 500);
          else if (j && P.client === "anthropic") { answer = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""); thinkText = (j.content || []).filter((b) => b.type === "thinking").map((b) => b.thinking).join(""); usage = j.usage || null; if (j.type === "error") answer = `[error] ${j.error?.message}`; }
          else if (j && P.client === "responses") { answer = (j.output || []).filter((it) => it.type === "message").flatMap((it) => it.content || []).filter((p) => p.type === "output_text").map((p) => p.text).join(""); thinkText = (j.output || []).filter((it) => it.type === "reasoning").flatMap((it) => it.summary || []).map((p) => p.text).join(""); usage = j.usage || null; if (j.error) answer = `[error] ${j.error.message || JSON.stringify(j.error)}`; }
          else if (j) { answer = j.choices?.[0]?.message?.content || ""; thinkText = j.choices?.[0]?.message?.reasoning_content || ""; usage = j.usage || null; if (j.error) answer = `[error] ${j.error.message || JSON.stringify(j.error)}`; }
          else answer = t.slice(0, 2000);
          if (!(isModels && j)) text.textContent = answer; think.querySelector("div").textContent = thinkText; think.classList.toggle("hidden", !thinkText);
        }
      } catch (/** @type {any} */ e) { answer += `\n[${e.name === "AbortError" ? "stopped" : "failed"}] ${e.message}`; text.textContent = answer; }
      const total = performance.now() - t0; const ok = httpStatus >= 200 && httpStatus < 300;
      const u = usage || {}; const inTok = u.input_tokens ?? u.prompt_tokens, outTok = u.output_tokens ?? u.completion_tokens, cr = u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens;
      status.replaceChildren(h("span", { class: `pill ${ok ? "ok" : "err"}` }, ok ? `HTTP ${httpStatus}` : `HTTP ${httpStatus || "—"}`), h("span", { class: "small muted" }, `first byte ${fmt.ms(Math.round(ttft ?? total))} · total ${fmt.ms(Math.round(total))}`), ...(inTok != null ? [h("span", { class: "small muted" }, `${fmt.n(inTok)} in${cr ? ` (${fmt.n(cr)} cached)` : ""} · ${fmt.n(outTok)} out`)] : []));
      if (requestId) api(`/requests/${requestId}`).then((rec) => recBox.replaceChildren(h("div", { class: "pg-rec" }, h("b", { class: "small" }, "What Filament did"), h("div", { class: "small muted" }, `route ${rec.route || "–"} → ${rec.upstream || "–"} / ${rec.upstreamModel || "–"}${rec.translatedFormats ? ` · translated ${rec.translatedFormats}` : ""}${rec.cost ? ` · ${fmt.usd(rec.cost)}` : ""}`), rec.changes?.length ? h("ul", { class: "small", style: "margin:4px 0" }, ...rec.changes.map((x) => h("li", {}, x))) : h("div", { class: "small muted" }, "no changes"), h("a", { href: "#", class: "small", onclick: (e) => { e.preventDefault(); openRequest(requestId); } }, "open the full request record")))).catch(() => {});
      letGo(); sendBtn.disabled = false; stopBtn.classList.add("hidden");
    };
    sendBtn.onclick = send;

    const tips = { anthropic: "This is what Claude Code and the Anthropic SDKs send: the key in x-api-key, the model in the body, thinking and effort in Anthropic's shape. If the route points at an OpenAI-style upstream or an agent, Filament translates.", openai: "This is what OpenAI SDKs and most third-party chat apps send: a Bearer key and /v1/chat/completions. Effort travels as a suffix on the model name or as reasoning_effort; Filament translates for Anthropic upstreams and agents." };
    return h("div", {},
      intro("playground",
        h("p", {}, "Every request your agent could make, sent from this page through the real Filament endpoints on this machine, with the reply shown as the agent would see it and, underneath, what Filament changed on the way. Nothing here is simulated: a chat request costs what a chat request costs, and agent requests start the agent."),
        h("ul", { class: "small" }, h("li", {}, "Pick the kind of client you want to imitate, then the endpoint. Pick a model name from the advertised list or type any name to see how a wrong one fails."), h("li", {}, "Attach an image to check the image path to that upstream. Add an effort or mode suffix to check they are understood."), h("li", {}, "The request preview and the copyable curl / PowerShell command are exactly what is sent, so you can reproduce a result outside the console."))),
      h("div", { class: "pg" },
        h("section", { class: "panel pg-req" }, h("h2", {}, "Request"),
          h("h4", {}, "Client"), clientSeg, h("p", { class: "muted small" }, tips[P.client]),
          h("h4", {}, "Endpoint"), epSeg, h("p", { class: "muted small" }, ENDPOINTS[P.client].find(([k]) => k === P.endpoint)?.[2] || ""),
          isModels ? null : h("div", {}, h("h4", {}, "Model"), h("div", { class: "row", style: "margin:0" }, h("label", { class: "grow" }, "advertised names", modelSel), h("label", { class: "grow" }, "or any name", modelIn)),
            isEmb ? null : h("div", { class: "row" }, h("label", {}, "effort suffix", effortSel), h("label", {}, "agent mode suffix", modeSel), h("label", {}, "max_tokens", maxIn), isChat ? h("label", { class: "check", style: "align-self:flex-end;padding-bottom:8px" }, streamCb, "stream") : null),
            h("p", { class: "small live-line" }, "Model name sent: ", h("code", {}, modelName() || "—"))),
          isModels ? null : h("div", {}, h("h4", {}, isEmb ? "Text to embed" : "Message"), promptTa, isEmb ? null : h("div", {}, h("h4", {}, "System prompt (optional)"), sysTa, h("h4", {}, "Image (optional)"), h("div", { class: "row", style: "margin:0;align-items:center" }, imgIn, imgInfo, P.image ? clearImg : null))),
          h("div", { class: "row", style: "margin-top:14px" }, sendBtn, stopBtn),
          h("h4", {}, "Exactly what will be sent"), previewBox,
          h("div", { class: "row", style: "margin:6px 0 4px;align-items:center" }, h("h4", { style: "margin:0" }, "Same request from a terminal"), curlSeg, h("span", { class: "grow" }), h("button", { class: "sm ghost", onclick: (e) => { navigator.clipboard?.writeText(curlBox.textContent).then(() => { e.target.textContent = "Copied"; setTimeout(() => (e.target.textContent = "Copy"), 1200); }, () => toast("Clipboard blocked by the browser", "err")); } }, "Copy")), curlBox),
        h("section", { class: "panel pg-res" }, h("h2", {}, "Response"), out)));
}
